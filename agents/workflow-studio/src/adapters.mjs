import { createHash } from "node:crypto";
import {
  accessSync,
  constants as fsConstants,
  realpathSync,
  statSync,
} from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import { spawn } from "node:child_process";
import { finished } from "node:stream";
import { renderWorkflow, validateArtifact } from "./core.mjs";

const AGENTS = new Set(["codex", "claude"]);
const SAFETY_INTENTS = new Set(["read-only", "workspace-write"]);
const APPROVAL_SEMANTICS = Object.freeze({
  algorithm: "sha256",
  scope: "exact-native-run-envelope",
  statement: "plan approved for native execution; graph not enforced",
});
const TRACE_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
  "protocol-error",
  "truncated",
]);
const DEFAULT_LIMITS = Object.freeze({
  maxLineBytes: 256 * 1024,
  maxEvents: 10_000,
  maxEventDepth: 64,
  maxEventNodes: 50_000,
  maxStderrBytes: 256 * 1024,
  cancellationGraceMs: 500,
  versionTimeoutMs: 2_000,
});

function adapterError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function assertAgent(agent) {
  if (!AGENTS.has(agent)) {
    throw adapterError(
      "ADAPTER_UNSUPPORTED",
      `Unsupported agent "${String(agent)}"; expected "codex" or "claude".`,
    );
  }
}

function assertJson(value, path = "$", seen = new Set()) {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw adapterError("INVALID_ARTIFACT", `${path} must be a finite number.`);
    }
    return;
  }
  if (typeof value !== "object") {
    throw adapterError(
      "INVALID_ARTIFACT",
      `${path} contains a non-JSON ${typeof value} value.`,
    );
  }
  if (seen.has(value)) {
    throw adapterError("INVALID_ARTIFACT", `${path} contains a cycle.`);
  }
  seen.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      assertJson(value[index], `${path}[${index}]`, seen);
    }
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw adapterError(
        "INVALID_ARTIFACT",
        `${path} must contain only plain JSON objects.`,
      );
    }
    for (const key of Object.keys(value)) {
      assertJson(value[key], `${path}.${key}`, seen);
    }
  }
  seen.delete(value);
}

function canonicalJson(value) {
  assertJson(value);
  function encode(item) {
    if (item === null || typeof item !== "object") return JSON.stringify(item);
    if (Array.isArray(item)) return `[${item.map(encode).join(",")}]`;
    return `{${Object.keys(item)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${encode(item[key])}`)
      .join(",")}}`;
  }
  return encode(value);
}

function cloneJson(value) {
  return JSON.parse(canonicalJson(value));
}

function assertEventBudget(
  value,
  {
    maxDepth = DEFAULT_LIMITS.maxEventDepth,
    maxNodes = DEFAULT_LIMITS.maxEventNodes,
  } = {},
) {
  const active = new Set();
  const stack = [{ value, depth: 0, exit: false }];
  let nodes = 0;
  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame.exit) {
      active.delete(frame.value);
      continue;
    }
    nodes += 1;
    if (nodes > maxNodes) {
      throw adapterError(
        "EVENT_STRUCTURE_LIMIT",
        `Provider event exceeds the ${maxNodes}-node normalization budget.`,
      );
    }
    if (frame.depth > maxDepth) {
      throw adapterError(
        "EVENT_STRUCTURE_LIMIT",
        `Provider event exceeds the depth-${maxDepth} normalization budget.`,
      );
    }
    const item = frame.value;
    if (
      item === null ||
      typeof item === "string" ||
      typeof item === "boolean"
    ) {
      continue;
    }
    if (typeof item === "number") {
      if (!Number.isFinite(item)) {
        throw adapterError(
          "INVALID_PROVIDER_EVENT",
          "Provider event contains a non-finite number.",
        );
      }
      continue;
    }
    if (typeof item !== "object") {
      throw adapterError(
        "INVALID_PROVIDER_EVENT",
        `Provider event contains a non-JSON ${typeof item} value.`,
      );
    }
    if (active.has(item)) {
      throw adapterError(
        "INVALID_PROVIDER_EVENT",
        "Provider event contains a cycle.",
      );
    }
    if (
      !Array.isArray(item) &&
      ![Object.prototype, null].includes(Object.getPrototypeOf(item))
    ) {
      throw adapterError(
        "INVALID_PROVIDER_EVENT",
        "Provider event must contain only plain JSON objects.",
      );
    }
    active.add(item);
    stack.push({ value: item, depth: frame.depth, exit: true });
    const children = Array.isArray(item)
      ? item
      : Object.keys(item).map((key) => item[key]);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({
        value: children[index],
        depth: frame.depth + 1,
        exit: false,
      });
    }
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function digestObject(value) {
  return sha256(Buffer.from(canonicalJson(value), "utf8"));
}

function withoutApproval(plan) {
  const clone = cloneJson(plan);
  delete clone.approval;
  return clone;
}

function approvalDigest(plan) {
  return digestObject({
    run_envelope: withoutApproval(plan),
    approval: APPROVAL_SEMANTICS,
  });
}

function validateApproval(approval) {
  if (approval === undefined) return;
  if (!approval || typeof approval !== "object" || Array.isArray(approval)) {
    throw adapterError("INVALID_PLAN", "Plan approval must be an object.");
  }
  const expectedKeys = ["algorithm", "digest", "scope", "statement"];
  const actualKeys = Object.keys(approval).sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw adapterError(
      "INVALID_PLAN",
      "Plan approval contains unsupported or missing fields.",
    );
  }
  if (
    approval.algorithm !== APPROVAL_SEMANTICS.algorithm ||
    approval.scope !== APPROVAL_SEMANTICS.scope ||
    approval.statement !== APPROVAL_SEMANTICS.statement ||
    typeof approval.digest !== "string" ||
    !/^[a-f0-9]{64}$/u.test(approval.digest)
  ) {
    throw adapterError(
      "INVALID_PLAN",
      "Plan approval metadata does not match the fixed native-run approval semantics.",
    );
  }
}

function normalizeBase64(value, label) {
  if (typeof value !== "string") {
    throw adapterError("INVALID_ARTIFACT", `${label} must be base64 text.`);
  }
  const compact = value.replace(/\s+/g, "");
  if (
    compact.length % 4 === 1 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)
  ) {
    throw adapterError("INVALID_ARTIFACT", `${label} is not valid base64.`);
  }
  const decoded = Buffer.from(compact, "base64");
  const expected = compact.replace(/=+$/u, "");
  const actual = decoded.toString("base64").replace(/=+$/u, "");
  if (actual !== expected) {
    throw adapterError("INVALID_ARTIFACT", `${label} is not valid base64.`);
  }
  return decoded;
}

function canonicalCwd(cwd) {
  if (typeof cwd !== "string" || cwd.length === 0) {
    throw adapterError("INVALID_CWD", "cwd must be a non-empty path.");
  }
  if (!isAbsolute(cwd)) {
    throw adapterError("INVALID_CWD", `cwd must be an absolute path: ${cwd}`, {
      cwd,
      reason: "not-absolute",
    });
  }
  let resolved;
  try {
    resolved = realpathSync(cwd);
    if (!statSync(resolved).isDirectory()) {
      throw adapterError("INVALID_CWD", `cwd is not a directory: ${cwd}`, {
        cwd,
        reason: "not-directory",
      });
    }
  } catch (error) {
    if (error?.code === "INVALID_CWD") throw error;
    const missing = ["ENOENT", "ENOTDIR"].includes(error?.code);
    throw adapterError(
      "INVALID_CWD",
      missing
        ? `cwd does not exist: ${cwd}`
        : `cwd is not accessible: ${cwd}`,
      {
        cwd,
        reason: missing ? "missing" : "inaccessible",
        cause_code: error?.code ?? null,
      },
    );
  }
  return resolved;
}

function safetyProfile(agent, intent) {
  if (!SAFETY_INTENTS.has(intent)) {
    throw adapterError(
      "INVALID_SAFETY_PROFILE",
      `Unsupported safety intent "${String(intent)}".`,
    );
  }
  if (agent === "codex") {
    return {
      intent,
      provider: "codex",
      sandbox: intent === "read-only" ? "read-only" : "workspace-write",
      boundary: "os-sandbox",
    };
  }
  return {
    intent,
    provider: "claude",
    permission_mode: intent === "read-only" ? "plan" : "acceptEdits",
    boundary: "tool-permission-policy-not-os-sandbox",
  };
}

function safeArgv(agent, cwd, safety) {
  if (agent === "codex") {
    return [
      "exec",
      "--json",
      "--ephemeral",
      "--sandbox",
      safety.sandbox,
      "-C",
      cwd,
      "-",
    ];
  }
  return [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--no-session-persistence",
    "--permission-mode",
    safety.permission_mode,
  ];
}

function sourcePathFromWorkflow(workflow) {
  const value = workflow?.source?.path ?? workflow?.source_path ?? null;
  return typeof value === "string" ? value : null;
}

function promptRecord(prompt) {
  const bytes =
    Buffer.isBuffer(prompt) || prompt instanceof Uint8Array
      ? Buffer.from(prompt)
      : typeof prompt === "string"
        ? Buffer.from(prompt, "utf8")
        : null;
  if (!bytes) {
    throw adapterError(
      "INVALID_PROMPT",
      "prompt must be a string, Buffer, or Uint8Array.",
    );
  }
  return {
    encoding: "base64",
    bytes_base64: bytes.toString("base64"),
    byte_length: bytes.length,
    sha256: sha256(bytes),
  };
}

function skillRecord(workflow) {
  const bytes = renderWorkflow(workflow);
  const actualHash = sha256(bytes);
  return {
    encoding: "base64",
    bytes_base64: bytes.toString("base64"),
    byte_length: bytes.length,
    sha256: actualHash,
    source_path: sourcePathFromWorkflow(workflow),
    delivery: "prompt-context",
  };
}

function validateByteRecord(record, label) {
  if (!record || typeof record !== "object") {
    throw adapterError("INVALID_PLAN", `${label} record is missing.`);
  }
  const bytes = normalizeBase64(record.bytes_base64, `${label}.bytes_base64`);
  if (record.byte_length !== bytes.length || record.sha256 !== sha256(bytes)) {
    throw adapterError(
      "INVALID_PLAN",
      `${label} bytes, length, or digest do not match.`,
    );
  }
  return bytes;
}

function commandFor(agent, cwd, safety) {
  return {
    executable: agent,
    argv: safeArgv(agent, cwd, safety),
    stdin: "approved-prompt-context",
    shell: false,
  };
}

function validatePlan(plan) {
  assertJson(plan);
  if (!plan || plan.kind !== "plan" || plan.ir_version !== "1.0") {
    throw adapterError(
      "INVALID_PLAN",
      'Expected a plan artifact with ir_version "1.0".',
    );
  }
  validateArtifact(plan);
  validateApproval(plan.approval);
  assertAgent(plan.agent);
  if (typeof plan.cwd !== "string" || !isAbsolute(plan.cwd)) {
    throw adapterError("INVALID_PLAN", "Plan cwd must be an absolute path.");
  }
  const expectedSafety = safetyProfile(plan.agent, plan.safety?.intent);
  if (canonicalJson(plan.safety) !== canonicalJson(expectedSafety)) {
    throw adapterError(
      "INVALID_PLAN",
      "Plan contains a modified or unsupported provider safety profile.",
    );
  }
  validateByteRecord(plan.prompt, "prompt");
  const skillBytes = validateByteRecord(plan.skill, "skill");
  if (
    !plan.workflow ||
    typeof plan.workflow !== "object" ||
    Array.isArray(plan.workflow)
  ) {
    throw adapterError("INVALID_PLAN", "Plan workflow snapshot is missing.");
  }
  const expectedWorkflowRevision = digestObject(plan.workflow);
  if (plan.workflow_revision !== expectedWorkflowRevision) {
    throw adapterError(
      "INVALID_PLAN",
      "Plan workflow_revision does not match the current workflow snapshot.",
    );
  }
  const renderedSkill = renderWorkflow(plan.workflow);
  if (!skillBytes.equals(renderedSkill)) {
    throw adapterError(
      "INVALID_PLAN",
      "Plan Skill bytes do not match the rendered workflow candidate.",
    );
  }
  const expectedCommand = commandFor(plan.agent, plan.cwd, expectedSafety);
  if (canonicalJson(plan.command) !== canonicalJson(expectedCommand)) {
    throw adapterError(
      "INVALID_PLAN",
      "Plan command differs from the fixed safe adapter command.",
    );
  }
  if (
    plan.approval !== undefined &&
    plan.approval.digest !== approvalDigest(plan)
  ) {
    throw adapterError(
      "INVALID_PLAN",
      "Plan approval digest does not match the exact native-run envelope.",
    );
  }
}

export function validateNativePlan(plan, { checkCwd = true } = {}) {
  if (typeof checkCwd !== "boolean") {
    throw adapterError(
      "INVALID_ARGUMENT",
      "checkCwd must be a boolean when provided.",
    );
  }
  validatePlan(plan);
  if (checkCwd) canonicalCwd(plan.cwd);
  return true;
}

function buildStdin(plan) {
  const promptBytes = validateByteRecord(plan.prompt, "prompt");
  const skillBytes = validateByteRecord(plan.skill, "skill");
  const graph = {
    ir_version: plan.ir_version,
    workflow: plan.workflow,
    workflow_revision: plan.workflow_revision,
    agent: plan.agent,
    cwd: plan.cwd,
    safety: plan.safety,
  };
  const header = Buffer.from(
    [
      "WORKFLOW STUDIO NATIVE EXECUTION",
      "The following Skill Markdown and declared workflow graph are the exact approved inputs.",
      "This native CLI run is not deterministic node-by-node graph enforcement.",
      `skill_sha256=${plan.skill.sha256}`,
      `skill_byte_length=${skillBytes.length}`,
      `prompt_sha256=${plan.prompt.sha256}`,
      `prompt_byte_length=${promptBytes.length}`,
      "",
      "----- BEGIN SKILL MARKDOWN -----",
      "",
    ].join("\n"),
    "utf8",
  );
  const between = Buffer.from(
    [
      "",
      "----- END SKILL MARKDOWN -----",
      "",
      "----- BEGIN DECLARED WORKFLOW JSON -----",
      canonicalJson(graph),
      "----- END DECLARED WORKFLOW JSON -----",
      "",
      "----- BEGIN USER REQUEST -----",
      "",
    ].join("\n"),
    "utf8",
  );
  const footer = Buffer.from(
    "\n----- END USER REQUEST -----\n",
    "utf8",
  );
  return Buffer.concat([header, skillBytes, between, promptBytes, footer]);
}

function mergeEnvironment(overrides) {
  if (overrides === undefined) return { ...process.env };
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
    throw adapterError("INVALID_ENVIRONMENT", "env must be a plain object.");
  }
  const merged = { ...process.env };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete merged[key];
    else merged[key] = String(value);
  }
  return merged;
}

function executableCandidates(name, env) {
  if (name.includes("/") || name.includes("\\")) return [name];
  const pathValue = Object.hasOwn(env, "PATH") ? env.PATH : process.env.PATH;
  if (!pathValue) return [];
  const suffixes =
    process.platform === "win32"
      ? (env.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";")
      : [""];
  const candidates = [];
  for (const directory of pathValue.split(delimiter)) {
    if (!directory) continue;
    for (const suffix of suffixes) candidates.push(join(directory, name + suffix));
  }
  return candidates;
}

function resolveExecutable(name, env) {
  for (const candidate of executableCandidates(name, env)) {
    try {
      accessSync(candidate, fsConstants.X_OK);
      if (statSync(candidate).isFile()) return realpathSync(candidate);
    } catch {
      // Continue searching PATH.
    }
  }
  return null;
}

function boundedPositiveInteger(value, fallback, maximum, label) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value <= 0 || value > maximum) {
    throw adapterError(
      "INVALID_LIMIT",
      `${label} must be an integer between 1 and ${maximum}.`,
    );
  }
  return value;
}

function normalizeLimits(limits = {}) {
  if (!limits || typeof limits !== "object" || Array.isArray(limits)) {
    throw adapterError("INVALID_LIMIT", "limits must be a plain object.");
  }
  return {
    maxLineBytes: boundedPositiveInteger(
      limits.maxLineBytes,
      DEFAULT_LIMITS.maxLineBytes,
      16 * 1024 * 1024,
      "maxLineBytes",
    ),
    maxEvents: boundedPositiveInteger(
      limits.maxEvents,
      DEFAULT_LIMITS.maxEvents,
      1_000_000,
      "maxEvents",
    ),
    maxEventDepth: boundedPositiveInteger(
      limits.maxEventDepth,
      DEFAULT_LIMITS.maxEventDepth,
      1_024,
      "maxEventDepth",
    ),
    maxEventNodes: boundedPositiveInteger(
      limits.maxEventNodes,
      DEFAULT_LIMITS.maxEventNodes,
      1_000_000,
      "maxEventNodes",
    ),
    maxStderrBytes: boundedPositiveInteger(
      limits.maxStderrBytes,
      DEFAULT_LIMITS.maxStderrBytes,
      16 * 1024 * 1024,
      "maxStderrBytes",
    ),
    cancellationGraceMs: boundedPositiveInteger(
      limits.cancellationGraceMs,
      DEFAULT_LIMITS.cancellationGraceMs,
      5_000,
      "cancellationGraceMs",
    ),
    versionTimeoutMs: boundedPositiveInteger(
      limits.versionTimeoutMs,
      DEFAULT_LIMITS.versionTimeoutMs,
      10_000,
      "versionTimeoutMs",
    ),
  };
}

function firstVersionLine(stdout, stderr) {
  const line = `${stdout}\n${stderr}`
    .split(/\r?\n/u)
    .map((part) => part.trim())
    .find(Boolean);
  return line ? line.slice(0, 512) : null;
}

function probeVersion(executable, env, timeoutMs) {
  return new Promise((resolve) => {
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let settled = false;
    let timedOut = false;
    const child = spawn(executable, ["--version"], {
      env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const append = (current, chunk) => {
      if (current.length >= 4096) return current;
      return Buffer.concat([current, chunk]).subarray(0, 4096);
    };
    child.stdout?.on("data", (chunk) => {
      stdout = append(stdout, Buffer.from(chunk));
    });
    child.stderr?.on("data", (chunk) => {
      stderr = append(stderr, Buffer.from(chunk));
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    child.on("error", (error) => {
      finish({
        ok: false,
        missing: error?.code === "ENOENT",
        error,
        stdout: stdout.toString("utf8"),
        stderr: stderr.toString("utf8"),
        version: null,
      });
    });
    child.on("close", (code, signal) => {
      const stdoutText = stdout.toString("utf8");
      const stderrText = stderr.toString("utf8");
      finish({
        ok: code === 0 && !timedOut,
        missing: false,
        code,
        signal,
        timed_out: timedOut,
        stdout: stdoutText,
        stderr: stderrText,
        version: firstVersionLine(stdoutText, stderrText),
      });
    });
  });
}

function rawType(agent, event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    return "malformed";
  }
  if (typeof event.type === "string") return event.type;
  if (agent === "claude" && typeof event.subtype === "string") {
    return event.subtype;
  }
  return "unknown";
}

function portableEvent(agent, event) {
  const type = rawType(agent, event);
  if (agent === "codex") {
    if (type === "thread.started") return ["run.started", "running"];
    if (type === "turn.started") return ["turn.started", "running"];
    if (type === "turn.completed") return ["turn.completed", "completed"];
    if (type === "turn.failed" || type === "error") {
      return ["turn.failed", "failed"];
    }
    if (type === "item.started" || type === "item.completed") {
      const itemType = event.item?.type;
      const ending = type.endsWith("completed") ? "completed" : "started";
      const itemFailed =
        ending === "completed" &&
        (event.is_error === true ||
          event.error !== undefined ||
          event.item?.is_error === true ||
          event.item?.error !== undefined ||
          ["error", "failed"].includes(event.item?.status) ||
          event.item?.exit_code > 0);
      if (
        itemType === "command_execution" ||
        itemType === "mcp_tool_call" ||
        itemType === "web_search"
      ) {
        return [
          itemFailed ? "tool.failed" : `tool.${ending}`,
          itemFailed
            ? "failed"
            : ending === "completed"
              ? "completed"
              : "running",
        ];
      }
      if (itemFailed || (ending === "completed" && itemType === "error")) {
        return ["tool.failed", "failed"];
      }
      if (itemType === "file_change" && ending === "completed") {
        return ["artifact.changed", "completed"];
      }
      if (itemType === "todo_list" || itemType === "plan") {
        return ["plan.updated", "completed"];
      }
      if (itemType === "agent_message" && ending === "completed") {
        return ["message.completed", "completed"];
      }
    }
  } else {
    if (type === "system" && event.subtype === "init") {
      return ["run.started", "running"];
    }
    if (type === "result") {
      const failed =
        event.is_error === true ||
        event.status === "failed" ||
        ["error", "failed"].includes(event.subtype);
      return [failed ? "run.failed" : "run.completed", failed ? "failed" : "completed"];
    }
    if (type === "assistant") {
      const content = event.message?.content;
      if (
        Array.isArray(content) &&
        content.some((block) => block?.type === "tool_use")
      ) {
        return ["tool.started", "running"];
      }
      return ["message.completed", "completed"];
    }
    if (type === "user") {
      const content = event.message?.content;
      if (Array.isArray(content)) {
        const toolResults = content.filter(
          (block) => block?.type === "tool_result",
        );
        if (toolResults.length > 0) {
          const failed = toolResults.some(
            (block) =>
              block.is_error === true ||
              block.status === "failed" ||
              block.error !== undefined,
          );
          return [
            failed ? "tool.failed" : "tool.completed",
            failed ? "failed" : "completed",
          ];
        }
      }
    }
    if (type === "tool_use" || type === "tool.started") {
      return ["tool.started", "running"];
    }
    if (type === "tool_result" || type === "tool.completed") {
      const failed =
        event.is_error === true ||
        event.status === "failed" ||
        event.error !== undefined;
      return [failed ? "tool.failed" : "tool.completed", failed ? "failed" : "completed"];
    }
    if (type === "hook_progress") return ["provider.retrying", "running"];
  }
  return ["provider.unknown", "observed"];
}

function eventIdentifier(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) return null;
  return (
    event.id ??
    event.item?.id ??
    event.message?.id ??
    event.tool_use_id ??
    null
  );
}

function parentEventIdentifier(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) return null;
  return event.parent_tool_use_id ?? event.parent_id ?? null;
}

function eventSummary(kind) {
  const summaries = {
    "run.started": "provider run started",
    "run.completed": "provider run completed",
    "run.failed": "provider run failed",
    "turn.started": "provider turn started",
    "turn.completed": "provider turn completed",
    "turn.failed": "provider turn failed",
    "tool.started": "tool activity started",
    "tool.completed": "tool activity completed",
    "tool.failed": "tool activity failed",
    "artifact.changed": "artifact change observed",
    "plan.updated": "plan update observed",
    "message.completed": "message completed",
    "provider.retrying": "provider progress observed",
    "provider.unknown": "unrecognized provider event preserved",
  };
  return summaries[kind] ?? "provider event observed";
}

export async function detectAdapter(agent, env) {
  assertAgent(agent);
  const effectiveEnv = mergeEnvironment(env);
  const executable = resolveExecutable(agent, effectiveEnv);
  if (!executable) {
    return {
      agent,
      available: false,
      status: "cli_missing",
      executable: null,
      expected_executable: agent,
      version: null,
      capabilities: {},
    };
  }
  const probe = await probeVersion(
    executable,
    effectiveEnv,
    DEFAULT_LIMITS.versionTimeoutMs,
  );
  if (!probe.ok) {
    return {
      agent,
      available: false,
      status: probe.missing ? "cli_missing" : "adapter_unsupported",
      executable,
      version: probe.version,
      capabilities: {},
      diagnostic: probe.stderr.slice(0, 4096),
    };
  }
  return {
    agent,
    available: true,
    status: "available",
    executable,
    version: probe.version,
    capabilities:
      agent === "codex"
        ? {
            non_interactive: true,
            stream_jsonl: true,
            sandbox: ["read-only", "workspace-write"],
            ephemeral: true,
          }
        : {
            non_interactive: true,
            stream_json: true,
            permission_modes: ["plan", "acceptEdits"],
            no_session_persistence: true,
          },
  };
}

export function buildRunEnvelope({
  workflow,
  prompt,
  agent,
  cwd,
  safety = "read-only",
}) {
  assertAgent(agent);
  if (!workflow || typeof workflow !== "object" || Array.isArray(workflow)) {
    throw adapterError("INVALID_ARTIFACT", "workflow must be a JSON object.");
  }
  assertJson(workflow);
  const canonicalDirectory = canonicalCwd(cwd);
  const effectiveSafety = safetyProfile(agent, safety);
  const workflowClone = cloneJson(workflow);
  const plan = {
    ir_version: "1.0",
    kind: "plan",
    agent,
    cwd: canonicalDirectory,
    safety: effectiveSafety,
    workflow: workflowClone,
    workflow_revision: digestObject(workflowClone),
    prompt: promptRecord(prompt),
    skill: skillRecord(workflow),
    execution_mode: "native-cli-prompt-context",
    warnings: [
      "The approved graph is supplied to the native CLI but is not enforced node by node.",
      agent === "claude"
        ? "Claude permission mode is a tool policy, not an OS sandbox; project customizations may be active."
        : "Codex execution uses the selected sandbox profile and may load local agent configuration.",
    ],
    command: commandFor(agent, canonicalDirectory, effectiveSafety),
  };
  return cloneJson(plan);
}

export function approvePlan(plan) {
  validateNativePlan(plan);
  const approved = withoutApproval(plan);
  approved.approval = {
    ...APPROVAL_SEMANTICS,
    digest: approvalDigest(approved),
  };
  return cloneJson(approved);
}

export function verifyPlanApproval(plan) {
  try {
    validatePlan(plan);
    if (plan.approval === undefined) return false;
    return true;
  } catch {
    return false;
  }
}

export function prepareAdapter(plan, executableOverride) {
  validateNativePlan(plan);
  if (executableOverride !== undefined) {
    throw adapterError(
      "EXECUTABLE_OVERRIDE_FORBIDDEN",
      "Executable selection is derived from the fixed agent adapter and cannot be overridden.",
    );
  }
  return {
    agent: plan.agent,
    executable: plan.agent,
    argv: safeArgv(plan.agent, plan.cwd, plan.safety),
    cwd: plan.cwd,
    env_policy: "caller-environment-not-recorded",
    shell: false,
    stdin: buildStdin(plan),
    safety: cloneJson(plan.safety),
  };
}

export function normalizeProviderEvent(agent, event, sequence, eventLimits) {
  assertAgent(agent);
  if (!Number.isInteger(sequence) || sequence < 0) {
    throw adapterError(
      "INVALID_SEQUENCE",
      "sequence must be a non-negative integer.",
    );
  }
  assertEventBudget(event, eventLimits);
  const malformed =
    !event || typeof event !== "object" || Array.isArray(event);
  const [kind, status] = portableEvent(agent, event);
  return {
    sequence,
    provider: agent,
    kind,
    status,
    provider_event_id: eventIdentifier(event),
    parent_provider_event_id: parentEventIdentifier(event),
    provenance: "observed",
    source: {
      raw_type: rawType(agent, event),
      confidence: kind === "provider.unknown" ? 0 : 1,
      malformed,
      raw: cloneJson(
        malformed
          ? {
              value:
                typeof event === "string"
                  ? event
                  : event === undefined
                    ? null
                    : String(event),
            }
          : event,
      ),
    },
    summary: eventSummary(kind),
  };
}

function normalizationDiagnosticEvent(agent, line, sequence, error) {
  const code =
    typeof error?.code === "string"
      ? error.code.slice(0, 64)
      : "EVENT_NORMALIZATION_FAILED";
  const message =
    typeof error?.message === "string"
      ? error.message.slice(0, 512)
      : "Provider event normalization failed.";
  return {
    sequence,
    provider: agent,
    kind: "provider.unknown",
    status: "observed",
    provider_event_id: null,
    parent_provider_event_id: null,
    provenance: "observed",
    source: {
      raw_type: "normalization-rejected",
      confidence: 0,
      malformed: false,
      raw: {
        omitted: true,
        reason: code,
        evidence: line.subarray(0, 2048).toString("utf8"),
      },
    },
    summary: "provider event rejected by bounded normalization",
    diagnostic: { code, message },
  };
}

function terminalEvidence(normalized) {
  if (
    normalized.kind === "turn.completed" ||
    normalized.kind === "run.completed"
  ) {
    return "completed";
  }
  if (
    normalized.kind === "turn.failed" ||
    normalized.kind === "run.failed"
  ) {
    return "failed";
  }
  return null;
}

function traceSkeleton(plan, prepared, adapterVersion) {
  return {
    ir_version: "1.0",
    kind: "trace",
    run_id: `run-${plan.approval.digest.slice(0, 16)}`,
    plan_hash: plan.approval.digest,
    workflow_revision: plan.workflow_revision,
    agent: plan.agent,
    cwd: plan.cwd,
    safety: cloneJson(plan.safety),
    adapter: {
      executable: prepared.executable,
      version: adapterVersion,
    },
    events: [],
    inferred_edges: [],
    diagnostics: [],
    process: {
      exit_code: null,
      signal: null,
      stderr: "",
      stderr_bytes: 0,
      stdout_bytes: 0,
    },
    status: "protocol-error",
    completeness: "partial",
    provenance: {
      events: "observed",
      sequence_edges: "inferred",
      hidden_reasoning_recovered: false,
    },
  };
}

function appendSequenceEdges(trace) {
  for (let index = 1; index < trace.events.length; index += 1) {
    trace.inferred_edges.push({
      from_sequence: trace.events[index - 1].sequence,
      to_sequence: trace.events[index].sequence,
      kind: "sequence",
      provenance: "inferred",
      confidence: 0.5,
    });
  }
}

function signalProcess(child, signal) {
  if (!child.pid) return;
  if (process.platform !== "win32") {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // The process may have already exited; fall back to the direct child.
    }
  }
  try {
    child.kill(signal);
  } catch {
    // The process already exited.
  }
}

export async function runApprovedPlan(
  plan,
  { env, signal, limits: providedLimits } = {},
) {
  if (!verifyPlanApproval(plan)) {
    throw adapterError(
      "APPROVAL_REQUIRED",
      "The plan is unapproved or changed since approval.",
    );
  }
  if (signal !== undefined && !(signal instanceof AbortSignal)) {
    throw adapterError("INVALID_SIGNAL", "signal must be an AbortSignal.");
  }
  const limits = normalizeLimits(providedLimits);
  const prepared = prepareAdapter(plan);
  const effectiveEnv = mergeEnvironment(env);
  const resolvedExecutable = resolveExecutable(plan.agent, effectiveEnv);
  const runtimePrepared = {
    ...prepared,
    executable: resolvedExecutable ?? plan.agent,
  };
  const probe = resolvedExecutable
    ? await probeVersion(
        resolvedExecutable,
        effectiveEnv,
        limits.versionTimeoutMs,
      )
    : {
        ok: false,
        missing: true,
        version: null,
        stderr: "",
      };
  const trace = traceSkeleton(plan, runtimePrepared, probe.version);
  if (!probe.ok) {
    trace.status = "failed";
    trace.failure = {
      kind: probe.missing ? "cli_missing" : "adapter_unsupported",
      message: probe.missing
        ? `CLI executable was not found: ${plan.agent}`
        : `CLI version probe failed: ${runtimePrepared.executable}`,
    };
    if (probe.stderr) {
      trace.process.stderr = probe.stderr.slice(0, limits.maxStderrBytes);
      trace.process.stderr_bytes = Buffer.byteLength(probe.stderr);
    }
    trace.diagnostics.push({
      kind: trace.failure.kind,
      message: trace.failure.message,
    });
    return trace;
  }

  if (signal?.aborted) {
    trace.status = "cancelled";
    trace.failure = {
      kind: "cancelled_by_wrapper",
      message: "Run was cancelled before the CLI process started.",
      provider_terminal_observed: false,
    };
    return trace;
  }

  return await new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(runtimePrepared.executable, runtimePrepared.argv, {
        cwd: runtimePrepared.cwd,
        env: effectiveEnv,
        shell: false,
        detached: process.platform !== "win32",
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      reject(error);
      return;
    }

    let lineBuffer = Buffer.alloc(0);
    let discardingLine = false;
    let parsedLineCount = 0;
    let sequence = 0;
    let successfulTerminalObserved = false;
    let failedTerminalObserved = false;
    let protocolError = false;
    let normalizationRejected = false;
    let truncated = false;
    let cancelled = false;
    let settled = false;
    let cancellationTimer = null;
    let stderrRetained = Buffer.alloc(0);

    const retainEvent = (normalized) => {
      if (trace.events.length >= limits.maxEvents) {
        truncated = true;
        return;
      }
      trace.events.push(normalized);
    };

    const handleLine = (
      line,
      {
        malformedKind = "malformed-jsonl",
        malformedSummary = "malformed provider JSONL preserved",
      } = {},
    ) => {
      if (parsedLineCount >= limits.maxEvents) {
        truncated = true;
        return;
      }
      parsedLineCount += 1;
      if (line.length > 0 && line.at(-1) === 0x0d) {
        line = line.subarray(0, line.length - 1);
      }
      if (line.length === 0) return;
      let event;
      try {
        event = JSON.parse(line.toString("utf8"));
      } catch {
        protocolError = true;
        const malformed = normalizeProviderEvent(
          plan.agent,
          line.toString("utf8"),
          sequence,
        );
        sequence += 1;
        malformed.source.raw_type = malformedKind;
        malformed.summary = malformedSummary;
        retainEvent(malformed);
        trace.diagnostics.push({
          kind: malformedKind,
          sequence: malformed.sequence,
          evidence: line.toString("utf8").slice(0, 2048),
        });
        return;
      }
      let normalized;
      try {
        normalized = normalizeProviderEvent(plan.agent, event, sequence, {
          maxDepth: limits.maxEventDepth,
          maxNodes: limits.maxEventNodes,
        });
      } catch (error) {
        protocolError = true;
        normalizationRejected = true;
        normalized = normalizationDiagnosticEvent(
          plan.agent,
          line,
          sequence,
          error,
        );
        sequence += 1;
        retainEvent(normalized);
        trace.diagnostics.push({
          kind: "event-normalization-rejected",
          sequence: normalized.sequence,
          code: normalized.diagnostic.code,
          message: normalized.diagnostic.message,
        });
        return;
      }
      sequence += 1;
      const evidence = terminalEvidence(normalized);
      if (evidence === "completed") successfulTerminalObserved = true;
      if (evidence === "failed") failedTerminalObserved = true;
      retainEvent(normalized);
    };

    const lineTooLong = (prefix) => {
      truncated = true;
      const evidence = normalizeProviderEvent(
        plan.agent,
        prefix.toString("utf8"),
        sequence,
      );
      sequence += 1;
      evidence.source.raw_type = "oversized-jsonl";
      evidence.source.truncated = true;
      evidence.summary = "oversized provider line truncated";
      retainEvent(evidence);
      trace.diagnostics.push({
        kind: "line-limit",
        limit_bytes: limits.maxLineBytes,
      });
    };

    child.stdout.on("data", (chunkValue) => {
      const chunk = Buffer.from(chunkValue);
      trace.process.stdout_bytes += chunk.length;
      let offset = 0;
      while (offset < chunk.length) {
        const newline = chunk.indexOf(0x0a, offset);
        const end = newline === -1 ? chunk.length : newline;
        const segment = chunk.subarray(offset, end);
        if (!discardingLine) {
          if (lineBuffer.length + segment.length > limits.maxLineBytes) {
            const remaining = Math.max(0, limits.maxLineBytes - lineBuffer.length);
            const prefix = Buffer.concat([
              lineBuffer,
              segment.subarray(0, remaining),
            ]);
            lineBuffer = Buffer.alloc(0);
            lineTooLong(prefix);
            discardingLine = newline === -1;
          } else {
            lineBuffer = Buffer.concat([lineBuffer, segment]);
          }
        }
        if (newline !== -1) {
          if (discardingLine) {
            discardingLine = false;
          } else {
            handleLine(lineBuffer);
            lineBuffer = Buffer.alloc(0);
          }
          offset = newline + 1;
        } else {
          offset = chunk.length;
        }
      }
    });

    child.stderr.on("data", (chunkValue) => {
      const chunk = Buffer.from(chunkValue);
      trace.process.stderr_bytes += chunk.length;
      if (stderrRetained.length < limits.maxStderrBytes) {
        const remaining = limits.maxStderrBytes - stderrRetained.length;
        stderrRetained = Buffer.concat([
          stderrRetained,
          chunk.subarray(0, remaining),
        ]);
      }
      if (trace.process.stderr_bytes > limits.maxStderrBytes) truncated = true;
    });

    const cancel = () => {
      if (cancelled || settled) return;
      cancelled = true;
      signalProcess(child, "SIGTERM");
      cancellationTimer = setTimeout(() => {
        signalProcess(child, "SIGKILL");
      }, limits.cancellationGraceMs);
      cancellationTimer.unref?.();
    };
    signal?.addEventListener("abort", cancel, { once: true });

    child.on("error", (error) => {
      if (settled) return;
      if (error?.code === "ENOENT") {
        trace.status = "failed";
        trace.failure = {
          kind: "cli_missing",
          message: `CLI executable was not found: ${runtimePrepared.executable}`,
        };
      } else {
        trace.status = "failed";
        trace.failure = {
          kind: "configuration_failed",
          message: error?.message ?? "CLI process failed to start.",
        };
      }
    });

    const stdinCompletion = new Promise((resolveCompletion) => {
      finished(child.stdin, (error) => {
        resolveCompletion(error ?? null);
      });
    });

    child.on("close", async (code, closeSignal) => {
      const stdinError = await stdinCompletion;
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", cancel);
      if (cancellationTimer) clearTimeout(cancellationTimer);
      trace.process.exit_code = code;
      trace.process.signal = closeSignal;
      trace.process.stderr = stderrRetained.toString("utf8");

      if (lineBuffer.length > 0 && !discardingLine) {
        handleLine(lineBuffer, {
          malformedKind: "partial-jsonl",
          malformedSummary: "partial final provider line preserved",
        });
      }

      if (stdinError) {
        trace.diagnostics.push({
          kind: "stdin-error",
          code:
            typeof stdinError.code === "string"
              ? stdinError.code.slice(0, 64)
              : null,
          message: (stdinError.message ?? "stdin write failed").slice(0, 512),
        });
      }

      const providerTerminalObserved =
        successfulTerminalObserved || failedTerminalObserved;
      if (cancelled) {
        trace.status = "cancelled";
        trace.failure = {
          kind: "cancelled_by_wrapper",
          provider_terminal_observed: providerTerminalObserved,
        };
      } else if (truncated) {
        trace.status = "truncated";
        trace.failure = {
          kind: "output_truncated",
          provider_terminal_observed: providerTerminalObserved,
        };
      } else if (stdinError) {
        trace.status = "failed";
        trace.failure = {
          kind: "input_delivery_failed",
          message: "The approved prompt and Skill bytes were not fully delivered to the native CLI.",
          provider_terminal_observed: providerTerminalObserved,
        };
      } else if (trace.failure || code !== 0 || failedTerminalObserved) {
        trace.status = "failed";
        trace.failure ??= {
          kind: failedTerminalObserved ? "agent_failed" : "configuration_failed",
          provider_terminal_observed: providerTerminalObserved,
        };
      } else if (protocolError || !successfulTerminalObserved) {
        trace.status = "protocol-error";
        trace.failure = {
          kind: normalizationRejected
            ? "event_normalization_rejected"
            : protocolError
              ? "malformed_stream"
              : "incomplete_stream",
          provider_terminal_observed: providerTerminalObserved,
        };
      } else {
        trace.status = "completed";
        trace.completeness = "complete";
      }

      if (!TRACE_STATUSES.has(trace.status)) {
        reject(adapterError("INTERNAL_ERROR", "Invalid trace status."));
        return;
      }
      appendSequenceEdges(trace);
      resolve(trace);
    });

    child.stdin.end(prepared.stdin);
  });
}

function validateSkillName(name) {
  if (
    typeof name !== "string" ||
    name.length < 1 ||
    name.length > 64 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(name)
  ) {
    throw adapterError(
      "INVALID_SKILL_NAME",
      "name must be 1-64 lowercase letters, digits, or single hyphen-separated segments.",
    );
  }
  return name;
}

function yamlString(value) {
  return JSON.stringify(String(value));
}

function normalizedMarkdownInline(value, fallback) {
  const normalized = String(value)
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return normalized || fallback;
}

function safeMarkdownParagraph(value) {
  const normalized = normalizedMarkdownInline(value, "Workflow draft.");
  return /^(?:#{1,6}(?:\s|$)|<!--)/u.test(normalized)
    ? `\\${normalized}`
    : normalized;
}

function safeMarkdownHeading(value, fallback) {
  const normalized = normalizedMarkdownInline(value, fallback);
  return /[ \t]+#+$/u.test(normalized) ? `${normalized}.` : normalized;
}

function safeGeneratedStepBody(value) {
  let fence = null;
  return String(value)
    .split(/(\r?\n)/u)
    .map((part, index) => {
      if (index % 2 === 1) return part;
      if (fence) {
        const closing = part.match(/^ {0,3}(`+|~+)[ \t]*$/u);
        if (
          closing &&
          closing[1][0] === fence.char &&
          closing[1].length >= fence.length
        ) {
          fence = null;
        }
        return part;
      }
      const opening = part.match(/^ {0,3}(`{3,}|~{3,})(.*)$/u);
      if (
        opening &&
        !(opening[1][0] === "`" && opening[2].includes("`"))
      ) {
        fence = {
          char: opening[1][0],
          length: opening[1].length,
        };
        return part;
      }
      return /^#{1,3}[ \t]+/u.test(part) ? `\\${part}` : part;
    })
    .join("");
}

function uniquePromotionId(candidate, prefix, index, used) {
  const base =
    typeof candidate === "string" && candidate.length > 0
      ? candidate
      : `${prefix}-${index + 1}`;
  let selected = base;
  let suffix = 2;
  while (used.has(selected)) {
    selected = `${base}-${suffix}`;
    suffix += 1;
  }
  used.add(selected);
  return selected;
}

function promotedEdges(candidates, endpointMap, nodeIds) {
  if (!Array.isArray(candidates)) return [];
  const validIds = new Set(nodeIds);
  const used = new Set();
  const edges = [];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const rawFrom = candidate.from ?? candidate.from_sequence;
    const rawTo = candidate.to ?? candidate.to_sequence;
    const from = endpointMap.get(String(rawFrom));
    const to = endpointMap.get(String(rawTo));
    const kind = candidate.kind ?? "sequence";
    if (
      !from ||
      !to ||
      from === to ||
      !validIds.has(from) ||
      !validIds.has(to) ||
      !["sequence", "parallel"].includes(kind)
    ) {
      continue;
    }
    const sourceProvenance =
      candidate.source_provenance ?? candidate.provenance;
    const sourceConfidence =
      candidate.source_confidence ??
      (typeof candidate.confidence === "number"
        ? candidate.confidence
        : undefined);
    edges.push({
      id: uniquePromotionId(candidate.id, "edge-promoted", edges.length, used),
      from,
      to,
      kind,
      ...(sourceProvenance === "inferred"
        ? { source_provenance: "inferred" }
        : {}),
      ...(typeof sourceConfidence === "number" &&
      sourceConfidence >= 0 &&
      sourceConfidence <= 1
        ? { source_confidence: sourceConfidence }
        : {}),
    });
  }
  return edges;
}

function planPromotionGraph(artifact) {
  const graph =
    (Array.isArray(artifact.workflow?.graph?.nodes) &&
      artifact.workflow.graph) ||
    (Array.isArray(artifact.workflow?.nodes) && artifact.workflow) ||
    (Array.isArray(artifact.graph?.nodes) && artifact.graph) ||
    { nodes: [], edges: [] };
  const usedIds = new Set();
  const endpointMap = new Map();
  const steps = [];
  for (const node of graph.nodes) {
    if (!node || typeof node !== "object") continue;
    const index = steps.length;
    const id = uniquePromotionId(node.id, "step-promoted", index, usedIds);
    if (typeof node.id === "string" && !endpointMap.has(node.id)) {
      endpointMap.set(node.id, id);
    }
    steps.push({
      id,
      title:
        typeof node.title === "string" && node.title.trim()
          ? node.title.trim()
          : `Step ${index + 1}`,
      body:
        typeof node.body === "string" && node.body.trim()
          ? safeGeneratedStepBody(node.body.trim())
          : "Follow this declared workflow step.",
    });
  }
  return {
    steps,
    edges: promotedEdges(
      graph.edges,
      endpointMap,
      steps.map((step) => step.id),
    ),
  };
}

function tracePromotionGraph(artifact) {
  const events = Array.isArray(artifact.events) ? artifact.events : [];
  const usedIds = new Set();
  const endpointMap = new Map();
  const steps = [];
  for (const event of events) {
    if (
      !event ||
      typeof event !== "object" ||
      typeof event.kind !== "string"
    ) {
      continue;
    }
    const index = steps.length;
    const displayKind = safeMarkdownHeading(
      event.kind,
      "provider.unknown",
    );
    const id = uniquePromotionId(
      typeof event.id === "string" ? event.id : null,
      "trace-event",
      index,
      usedIds,
    );
    endpointMap.set(String(event.sequence ?? index), id);
    if (typeof event.id === "string") endpointMap.set(event.id, id);
    steps.push({
      id,
      title: displayKind,
      body: `Reproduce the selected ${displayKind} workflow behavior. This step was derived from observable telemetry, not hidden reasoning.`,
    });
  }
  const edgeCandidates =
    artifact.inferred_edges ?? artifact.graph?.edges ?? [];
  return {
    steps,
    edges: promotedEdges(
      edgeCandidates,
      endpointMap,
      steps.map((step) => step.id),
    ),
  };
}

function promotionGraph(artifact) {
  return artifact.kind === "plan"
    ? planPromotionGraph(artifact)
    : tracePromotionGraph(artifact);
}

function validatePromotableArtifact(artifact) {
  try {
    validateArtifact(artifact);
    if (artifact.kind === "plan") {
      validatePlan(artifact);
      if (
        artifact.approval !== undefined &&
        artifact.approval.digest !== approvalDigest(artifact)
      ) {
        throw adapterError(
          "INVALID_PLAN",
          "Plan approval does not match the artifact selected for promotion.",
        );
      }
    }
  } catch (error) {
    if (error?.code === "INVALID_ARTIFACT") throw error;
    throw adapterError(
      "INVALID_ARTIFACT",
      `Artifact cannot be promoted: ${error?.message ?? "validation failed"}`,
      { cause_code: error?.code ?? null },
    );
  }
  const promoted = promotionGraph(artifact);
  if (promoted.steps.length === 0) {
    throw adapterError(
      "INVALID_ARTIFACT",
      `The ${artifact.kind} artifact contains no promotable workflow steps.`,
    );
  }
  return promoted;
}

export function promoteArtifact(artifact, { name, description }) {
  if (
    !artifact ||
    typeof artifact !== "object" ||
    !["plan", "trace"].includes(artifact.kind) ||
    artifact.ir_version !== "1.0"
  ) {
    throw adapterError(
      "INVALID_ARTIFACT",
      "Only version 1.0 plan or trace artifacts can be promoted.",
    );
  }
  assertJson(artifact);
  const promoted = validatePromotableArtifact(artifact);
  validateSkillName(name);
  if (
    typeof description !== "string" ||
    description.trim().length === 0 ||
    description.length > 1024
  ) {
    throw adapterError(
      "INVALID_DESCRIPTION",
      "description must contain 1-1024 characters.",
    );
  }
  const displayDescription = safeMarkdownParagraph(description);
  const derivedHash = digestObject(artifact);
  const warnings = [
    "Draft requires human review before installation or execution.",
    artifact.kind === "trace"
      ? "Observed sequence is not a recovered reasoning or causal graph."
      : "Native execution does not enforce the declared graph node by node.",
  ];
  const { steps } = promoted;
  const metadataKey = `workflow-studio-${artifact.kind}-sha256`;
  const frontmatter = [
    "---",
    `name: ${name}`,
    `description: ${yamlString(displayDescription)}`,
    "metadata:",
    `  workflow-studio-derived-from: ${yamlString(artifact.kind)}`,
    `  ${metadataKey}: ${yamlString(derivedHash)}`,
    "---",
  ].join("\n");
  const workflowMarkdown = steps
    .map(
      (step, index) =>
        `### Step ${index + 1}: ${step.title}\n\n${step.body}`,
    )
    .join("\n\n");
  const warningMarkdown = warnings.map((warning) => `- ${warning}`).join("\n");
  const managed = {
    ir_version: "1.0",
    nodes: steps.map((step, order) => ({
      id: step.id,
      order,
      title_sha256: sha256(Buffer.from(step.title, "utf8")),
    })),
    edges: promoted.edges,
  };
  const encodedManaged = Buffer.from(
    canonicalJson(managed),
    "utf8",
  ).toString("base64url");
  const skillMarkdown = `${frontmatter}\n\n# ${name}\n\n${displayDescription}\n\n## Workflow\n\n${workflowMarkdown}\n\n## Provenance and limitations\n\n${warningMarkdown}\n\n<!-- workflow-studio:v1 ${encodedManaged} -->\n`;
  return {
    ir_version: "1.0",
    kind: "skill-draft",
    name,
    description: displayDescription,
    derived_from: {
      kind: artifact.kind,
      sha256: derivedHash,
    },
    warnings,
    files: {
      "SKILL.md": skillMarkdown,
    },
    skill_markdown: skillMarkdown,
  };
}
