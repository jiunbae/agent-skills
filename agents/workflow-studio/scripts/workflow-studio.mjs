#!/usr/bin/env node

import { link, open, readFile, lstat, mkdir, rename, rm } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  applyOperation,
  diffText,
  importSkillBytes,
  importSkillFile,
  renderWorkflow,
  validateArtifact,
  writeWorkflow,
} from "../src/core.mjs";
import {
  approvePlan,
  buildRunEnvelope,
  promoteArtifact,
  runApprovedPlan,
  validateNativePlan,
  verifyPlanApproval,
} from "../src/adapters.mjs";
import { createStudioServer } from "../src/server.mjs";
import {
  airToLegacy,
  decodeAirMarkdownArtifact,
  encodeAirMarkdownArtifact,
  migrateLegacyToAir,
  validateAirArtifact,
} from "../src/air.mjs";
import { parseIJson } from "../shared/air-codec.mjs";
import {
  createSkillCatalog,
  resolveSkillRoots,
} from "../src/catalog.mjs";
import {
  createSessionRegistry,
  resolveSessionRoots,
} from "../src/sessions.mjs";

const ASSETS_DIR = resolve(import.meta.dirname, "../assets");
const SCHEMAS_DIR = resolve(import.meta.dirname, "../schemas");
const COMPONENT_SKILLS_ROOT = resolve(import.meta.dirname, "../..");
const HELP = `AIR Workbench

Usage:
  air import SKILL.md --out WORKFLOW.air.json
  air validate ARTIFACT.air.json|WORKFLOW.air.md
  air convert INPUT.air.json|INPUT.air.md --out OUTPUT.air.json|OUTPUT.air.md
  air migrate LEGACY.json|LEGACY.md --to air/1 --out OUTPUT.air.json|OUTPUT.air.md
  air workbench [ARTIFACT] [--host loopback|127.0.0.1|::1|0.0.0.0] [--port N]

Legacy compatibility:
  workflow-studio import SKILL --out IR
  workflow-studio validate ARTIFACT
  workflow-studio edit IR --operation JSON|@file --out IR
  workflow-studio diff IR
  workflow-studio export IR --out PATH
  workflow-studio studio SKILL|ARTIFACT [--host loopback|127.0.0.1|::1|0.0.0.0] [--port N]
  workflow-studio plan IR (--prompt TEXT | --prompt-file FILE) --agent codex|claude
                       --cwd DIR --safety read-only|workspace-write --out PLAN
  workflow-studio approve PLAN --out APPROVED
  workflow-studio run APPROVED --trace TRACE
  workflow-studio promote PLAN|TRACE --name NAME --description TEXT --out DIR

Notes:
  SKILL.md remains the native execution artifact. A plan must be approved
  explicitly before "run", and any later mutation invalidates that approval.
  Markdown export writes only to a new path. The legacy --in-place option is
  explicitly refused. Output files and promoted directories must not already
  exist. There is no force-overwrite, arbitrary argument passthrough, or
  permission-bypass mode.
  "studio" serves a local browser editor, prints its token URL, and stays open
  until SIGINT or SIGTERM. Edits remain client-side until downloaded. The
  default is loopback; explicit 0.0.0.0 exposes it to IPv4 networks, so keep
  the token URL private.
  AIR commands are additive. Every AIR output must be a new .air.json file,
  or a workflow-only .air.md carrier. AIR Workbench discovers bounded local
  Skill and metadata-only Codex/Claude session roots by default. Explicit
  0.0.0.0 is plaintext LAN consent and exposes both tokenized read-only
  catalogs and metadata-only snapshots to IPv4 peers.
`;

function cliError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function parseCommand(argv) {
  if (
    argv.length === 0 ||
    argv[0] === "--help" ||
    argv[0] === "-h" ||
    argv[0] === "help"
  ) {
    return { command: "help", positionals: [], options: new Map() };
  }
  const command = argv[0];
  const positionals = [];
  const options = new Map();
  let positionalOnly = false;
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--") {
      positionalOnly = true;
      continue;
    }
    if (!positionalOnly && token.startsWith("--")) {
      const name = token.slice(2);
      if (!name) {
        throw cliError("INVALID_ARGUMENT", 'Use "--" only once before paths.');
      }
      if (options.has(name)) {
        throw cliError("DUPLICATE_OPTION", `Option --${name} was provided twice.`);
      }
      if (name === "in-place" || name === "help") {
        options.set(name, true);
        continue;
      }
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw cliError("MISSING_OPTION_VALUE", `Option --${name} requires a value.`);
      }
      options.set(name, value);
      index += 1;
      continue;
    }
    positionals.push(token);
  }
  return { command, positionals, options };
}

function assertShape(parsed, {
  positionals,
  required = [],
  optional = [],
  booleans = [],
} = {}) {
  if (parsed.positionals.length !== positionals) {
    throw cliError(
      "INVALID_ARGUMENT",
      `${parsed.command} expects ${positionals} positional argument${positionals === 1 ? "" : "s"}.`,
    );
  }
  const allowed = new Set([...required, ...optional, ...booleans]);
  for (const name of parsed.options.keys()) {
    if (!allowed.has(name)) {
      throw cliError(
        "UNKNOWN_OPTION",
        `Unknown option for ${parsed.command}: --${name}`,
      );
    }
  }
  for (const name of required) {
    if (!parsed.options.has(name)) {
      throw cliError(
        "MISSING_OPTION",
        `${parsed.command} requires --${name}.`,
      );
    }
  }
}

function option(parsed, name) {
  return parsed.options.get(name);
}

function result(value) {
  process.stdout.write(`${JSON.stringify({ ok: true, ...value })}\n`);
}

async function assertInputFile(path) {
  const absolute = resolve(path);
  const info = await lstat(absolute);
  if (info.isSymbolicLink()) {
    throw cliError("SYMLINK_REFUSED", `Refusing symbolic-link input: ${path}`);
  }
  if (!info.isFile()) {
    throw cliError("INVALID_PATH", `Input is not a file: ${path}`);
  }
  return absolute;
}

async function readJson(path) {
  const absolute = await assertInputFile(path);
  let parsed;
  try {
    parsed = JSON.parse(await readFile(absolute, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw cliError("INVALID_JSON", `Invalid JSON artifact: ${path}`, {
        cause: error.message,
      });
    }
    throw error;
  }
  return parsed;
}

async function reserveNewFile(path) {
  const absolute = resolve(path);
  const parent = dirname(absolute);
  try {
    await lstat(absolute);
    throw cliError(
      "OUTPUT_EXISTS",
      `Output already exists; V1 does not force overwrite: ${absolute}`,
    );
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const temporary = join(
    parent,
    `.workflow-studio-${process.pid}-${Date.now()}-${process.hrtime.bigint()}.tmp`,
  );
  try {
    const handle = await open(temporary, "wx", 0o600);
    return {
      absolute,
      temporary,
      handle,
      identity: await handle.stat({ bigint: true }),
      committed: false,
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw cliError("INVALID_PATH", `Output parent does not exist: ${parent}`);
    }
    throw error;
  }
}

function sameFileIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

async function removeOwnedTemporary(reservation) {
  let current;
  try {
    current = await lstat(reservation.temporary, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  if (!sameFileIdentity(current, reservation.identity)) return;
  await rm(reservation.temporary);
}

async function discardReservation(reservation) {
  if (reservation.handle) {
    await reservation.handle.close().catch(() => {});
    reservation.handle = null;
  }
  if (!reservation.committed) {
    await removeOwnedTemporary(reservation).catch(() => {});
  }
}

async function commitReservation(reservation, bytes) {
  try {
    await reservation.handle.writeFile(bytes);
    await reservation.handle.sync();
    const temporaryInfo = await lstat(reservation.temporary, { bigint: true });
    if (!sameFileIdentity(temporaryInfo, reservation.identity)) {
      throw cliError(
        "OUTPUT_CHANGED",
        `Private output reservation changed; no artifact was published: ${reservation.absolute}`,
      );
    }
    await reservation.handle.close();
    reservation.handle = null;
    try {
      await link(reservation.temporary, reservation.absolute);
    } catch (error) {
      if (error?.code === "EEXIST") {
        throw cliError(
          "OUTPUT_CHANGED",
          `Output became occupied after preflight; no artifact was published: ${reservation.absolute}`,
        );
      }
      throw error;
    }
    const publishedInfo = await lstat(reservation.absolute, { bigint: true });
    if (!sameFileIdentity(publishedInfo, reservation.identity)) {
      throw cliError(
        "OUTPUT_CHANGED",
        `Output pathname changed during publication; the artifact was not safely published: ${reservation.absolute}`,
      );
    }
    await removeOwnedTemporary(reservation);
    reservation.committed = true;
  } catch (error) {
    await discardReservation(reservation);
    throw error;
  }
  return reservation.absolute;
}

async function writeNewFile(path, bytes) {
  const reservation = await reserveNewFile(path);
  const absolute = await commitReservation(reservation, bytes);
  return absolute;
}

async function writeReservedJson(reservation, artifact) {
  const bytes = Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  const absolute = await commitReservation(reservation, bytes);
  return { path: absolute, byte_length: bytes.length };
}

async function writeJson(path, artifact) {
  const bytes = Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  const absolute = await writeNewFile(path, bytes);
  return { path: absolute, byte_length: bytes.length };
}

function airExtension(path) {
  const lower = String(path).toLowerCase();
  if (lower.endsWith(".air.json")) return "json";
  if (lower.endsWith(".air.md")) return "markdown";
  return null;
}

function requireAirOutput(path, artifact, { jsonOnly = false } = {}) {
  const carrier = airExtension(path);
  if (
    carrier === null ||
    (jsonOnly && carrier !== "json") ||
    (carrier === "markdown" && artifact.kind !== "workflow")
  ) {
    throw cliError(
      "AIR_OUTPUT_EXTENSION_MISMATCH",
      jsonOnly
        ? "AIR import output must end in .air.json."
        : artifact.kind === "workflow"
          ? "AIR output must end in .air.json or .air.md."
          : `AIR ${artifact.kind} output must end in .air.json; .air.md is workflow-only.`,
    );
  }
  return carrier;
}

async function readAir(path) {
  const absolute = await assertInputFile(path);
  const carrier = airExtension(path);
  if (carrier === null) {
    throw cliError(
      "AIR_INPUT_EXTENSION_MISMATCH",
      "AIR input must end in .air.json or .air.md.",
    );
  }
  const bytes = await readFile(absolute);
  const artifact = carrier === "markdown"
    ? decodeAirMarkdownArtifact(bytes).artifact
    : parseIJson(bytes);
  validateAirArtifact(artifact);
  return { absolute, artifact };
}

async function publishAir(path, artifact, options = {}) {
  validateAirArtifact(artifact);
  const carrier = requireAirOutput(path, artifact, options);
  const bytes = carrier === "markdown"
    ? encodeAirMarkdownArtifact(artifact)
    : Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return {
    path: await writeNewFile(path, bytes),
    byte_length: bytes.byteLength,
    carrier,
  };
}

async function airImportCommand(parsed) {
  assertShape(parsed, { positionals: 1, required: ["out"] });
  if (airExtension(parsed.positionals[0]) !== null) {
    throw cliError("ALREADY_AIR", "AIR input does not need to be imported.");
  }
  const workflow = await importSkillFile(parsed.positionals[0]);
  const artifact = migrateLegacyToAir(workflow);
  const written = await publishAir(option(parsed, "out"), artifact, {
    jsonOnly: true,
  });
  result({
    command: "air import",
    artifact: written.path,
    kind: artifact.kind,
    artifact_id: artifact.artifact_id,
  });
}

async function airValidateCommand(parsed) {
  assertShape(parsed, { positionals: 1 });
  const { absolute, artifact } = await readAir(parsed.positionals[0]);
  result({
    command: "air validate",
    artifact: absolute,
    kind: artifact.kind,
    air_version: artifact.air_version,
    artifact_id: artifact.artifact_id,
  });
}

async function airConvertCommand(parsed) {
  assertShape(parsed, { positionals: 1, required: ["out"] });
  const { artifact } = await readAir(parsed.positionals[0]);
  const written = await publishAir(option(parsed, "out"), artifact);
  result({
    command: "air convert",
    artifact: written.path,
    kind: artifact.kind,
    carrier: written.carrier,
    artifact_id: artifact.artifact_id,
  });
}

async function readLegacyForMigration(path) {
  if (airExtension(path) !== null) {
    throw cliError("ALREADY_AIR", "Input is already an AIR artifact.");
  }
  if (isSkillPath(path)) return importSkillFile(path);
  const artifact = await readJson(path);
  if (artifact?.format === "air") {
    throw cliError("ALREADY_AIR", "Input is already an AIR artifact.");
  }
  validateArtifact(artifact);
  return artifact;
}

async function airMigrateCommand(parsed) {
  assertShape(parsed, {
    positionals: 1,
    required: ["to", "out"],
  });
  if (option(parsed, "to") !== "air/1") {
    throw cliError("AIR_UNSUPPORTED_VERSION", 'AIR migration target must be "air/1".');
  }
  const artifact = migrateLegacyToAir(
    await readLegacyForMigration(parsed.positionals[0]),
  );
  const written = await publishAir(option(parsed, "out"), artifact);
  result({
    command: "air migrate",
    artifact: written.path,
    kind: artifact.kind,
    carrier: written.carrier,
    artifact_id: artifact.artifact_id,
  });
}

function requireKind(artifact, kind) {
  validateArtifact(artifact);
  if (artifact.kind !== kind) {
    throw cliError(
      "INVALID_ARTIFACT",
      `Expected a ${kind} artifact, received ${String(artifact.kind)}.`,
    );
  }
  return artifact;
}

async function importCommand(parsed) {
  assertShape(parsed, { positionals: 1, required: ["out"] });
  const workflow = await importSkillFile(parsed.positionals[0]);
  const written = await writeJson(option(parsed, "out"), workflow);
  result({
    command: "import",
    artifact: written.path,
    nodes: workflow.graph.nodes.length,
    diagnostics: workflow.diagnostics.length,
  });
}

async function validateCommand(parsed) {
  assertShape(parsed, { positionals: 1 });
  const artifact = await readJson(parsed.positionals[0]);
  if (artifact?.kind === "plan" && artifact?.ir_version === "1.0") {
    validateNativePlan(artifact);
  } else {
    validateArtifact(artifact);
  }
  result({
    command: "validate",
    artifact: resolve(parsed.positionals[0]),
    kind: artifact.kind,
    ir_version: artifact.ir_version,
  });
}

async function operationValue(value) {
  const text = value.startsWith("@")
    ? await readFile(await assertInputFile(value.slice(1)), "utf8")
    : value;
  try {
    return JSON.parse(text);
  } catch (error) {
    throw cliError("INVALID_JSON", "Operation must be valid JSON.", {
      cause: error.message,
    });
  }
}

async function editCommand(parsed) {
  assertShape(parsed, {
    positionals: 1,
    required: ["operation", "out"],
  });
  const workflow = requireKind(await readJson(parsed.positionals[0]), "workflow");
  const operation = await operationValue(option(parsed, "operation"));
  const changed = applyOperation(workflow, operation);
  const written = await writeJson(option(parsed, "out"), changed);
  result({
    command: "edit",
    artifact: written.path,
    revision: changed.revision.current_sha256,
  });
}

async function diffCommand(parsed) {
  assertShape(parsed, { positionals: 1 });
  const workflow = requireKind(await readJson(parsed.positionals[0]), "workflow");
  const original = Buffer.from(workflow.source.raw_base64, "base64");
  process.stdout.write(
    diffText(original, renderWorkflow(workflow), basename(workflow.source.path)),
  );
}

async function exportCommand(parsed) {
  assertShape(parsed, {
    positionals: 1,
    optional: ["out"],
    booleans: ["in-place"],
  });
  const hasOut = parsed.options.has("out");
  const inPlace = parsed.options.has("in-place");
  if (inPlace) {
    throw cliError(
      "IN_PLACE_UNSUPPORTED",
      "Portable V1 does not support in-place export; use --out with a new path.",
    );
  }
  if (!hasOut) {
    throw cliError(
      "INVALID_ARGUMENT",
      "export requires --out with a new path.",
    );
  }
  const workflow = requireKind(await readJson(parsed.positionals[0]), "workflow");
  if (
    hasOut &&
    resolve(option(parsed, "out")) === resolve(workflow.source.path)
  ) {
    throw cliError(
      "IN_PLACE_UNSUPPORTED",
      "Portable V1 cannot export over the imported source; use --out with a new path.",
    );
  }
  const written = await writeWorkflow(workflow, {
    outputPath: option(parsed, "out"),
  });
  result({ command: "export", ...written });
}

function isSkillPath(path) {
  return basename(path) === "SKILL.md" || extname(path).toLowerCase() === ".md";
}

async function readStudioArtifact(path) {
  if (isSkillPath(path)) return importSkillFile(path);
  const artifact = await readJson(path);
  validateArtifact(artifact);
  return artifact;
}

async function readWorkbenchArtifact(path) {
  if (airExtension(path) !== null) {
    return airToLegacy((await readAir(path)).artifact);
  }
  return readStudioArtifact(path);
}

function studioHost(value) {
  if (value === undefined || value === "loopback") return "127.0.0.1";
  if (
    value === "127.0.0.1" ||
    value === "::1" ||
    value === "0.0.0.0"
  ) {
    return value;
  }
  throw cliError(
    "INVALID_HOST",
    'Studio host must be "loopback", "127.0.0.1", "::1", or "0.0.0.0".',
  );
}

function studioPort(value) {
  if (value === undefined) return 0;
  if (!/^(?:0|[1-9][0-9]{0,4})$/u.test(value)) {
    throw cliError("INVALID_PORT", "Studio port must be an integer from 0 to 65535.");
  }
  const port = Number(value);
  if (port > 65_535) {
    throw cliError("INVALID_PORT", "Studio port must be an integer from 0 to 65535.");
  }
  return port;
}

async function serveWorkbench({
  artifact,
  catalog,
  sessionRegistry = null,
  host,
  port,
  lanWarning,
}) {
  if (lanWarning && host === "0.0.0.0") {
    process.stderr.write(
      "AIR Workbench warning: 0.0.0.0 exposes the tokenized local Skill catalog and metadata-only session catalog/snapshots over plaintext HTTP to IPv4 LAN peers. The URL token is bearer authority; keep it private.\n",
    );
  }
  const studio = createStudioServer({
    artifact,
    assetsDir: ASSETS_DIR,
    schemasDir: SCHEMAS_DIR,
    catalog,
    sessionRegistry,
    host,
    port,
  });
  const address = await studio.listen();
  if (sessionRegistry !== null) {
    void sessionRegistry.catalog({ refresh: true }).catch(() => {});
  }
  const literal = address.family === "IPv6" ? `[${address.address}]` : address.address;
  const url = `http://${literal}:${address.port}/?token=${encodeURIComponent(studio.token)}`;
  process.stdout.write(`${url}\n`);

  await new Promise((resolvePromise, rejectPromise) => {
    let closing = false;
    const close = async () => {
      if (closing) return;
      closing = true;
      process.off("SIGINT", close);
      process.off("SIGTERM", close);
      try {
        await studio.close();
        resolvePromise();
      } catch (error) {
        rejectPromise(error);
      }
    };
    process.on("SIGINT", close);
    process.on("SIGTERM", close);
  });
}

async function studioCommand(parsed) {
  assertShape(parsed, {
    positionals: 1,
    optional: ["host", "port"],
  });
  const host = studioHost(option(parsed, "host"));
  const port = studioPort(option(parsed, "port"));
  const artifact = await readStudioArtifact(parsed.positionals[0]);
  await serveWorkbench({
    artifact,
    catalog: null,
    sessionRegistry: null,
    host,
    port,
    lanWarning: false,
  });
}

function emptyWorkbenchArtifact() {
  return importSkillBytes(
    Buffer.from(
      "---\nname: air-workbench-empty\ndescription: Empty AIR Workbench document\n---\n\n## Workflow\n",
      "utf8",
    ),
    { sourcePath: "air-workbench/empty/SKILL.md" },
  );
}

async function airWorkbenchCommand(parsed) {
  if (parsed.positionals.length > 1) {
    throw cliError(
      "INVALID_ARGUMENT",
      "air workbench accepts zero or one initial artifact.",
    );
  }
  assertShape(parsed, {
    positionals: parsed.positionals.length,
    optional: ["host", "port"],
  });
  const host = studioHost(option(parsed, "host"));
  const port = studioPort(option(parsed, "port"));
  const catalog = createSkillCatalog({
    roots: resolveSkillRoots({
      cwd: process.cwd(),
      componentRoot: COMPONENT_SKILLS_ROOT,
    }),
  });
  const sessionRegistry = createSessionRegistry({
    roots: resolveSessionRoots({
      cwd: process.cwd(),
      home: process.env.HOME,
    }),
  });
  const snapshot = await catalog.initialize();
  let artifact;
  if (parsed.positionals.length === 1) {
    artifact = await readWorkbenchArtifact(parsed.positionals[0]);
  } else if (snapshot.items.length > 0) {
    artifact = await catalog.importArtifact(snapshot.items[0].id);
  } else {
    artifact = emptyWorkbenchArtifact();
  }
  await serveWorkbench({
    artifact,
    catalog,
    sessionRegistry,
    host,
    port,
    lanWarning: true,
  });
}

async function promptValue(parsed) {
  const inline = parsed.options.has("prompt");
  const fromFile = parsed.options.has("prompt-file");
  if (inline === fromFile) {
    throw cliError(
      "INVALID_ARGUMENT",
      "plan requires exactly one of --prompt or --prompt-file.",
    );
  }
  if (inline) return option(parsed, "prompt");
  return readFile(await assertInputFile(option(parsed, "prompt-file")));
}

async function planCommand(parsed) {
  assertShape(parsed, {
    positionals: 1,
    required: ["agent", "cwd", "safety", "out"],
    optional: ["prompt", "prompt-file"],
  });
  const workflow = requireKind(await readJson(parsed.positionals[0]), "workflow");
  const plan = buildRunEnvelope({
    workflow,
    prompt: await promptValue(parsed),
    agent: option(parsed, "agent"),
    cwd: option(parsed, "cwd"),
    safety: option(parsed, "safety"),
  });
  const written = await writeJson(option(parsed, "out"), plan);
  result({
    command: "plan",
    artifact: written.path,
    agent: plan.agent,
    approved: false,
  });
}

async function approveCommand(parsed) {
  assertShape(parsed, { positionals: 1, required: ["out"] });
  const plan = requireKind(await readJson(parsed.positionals[0]), "plan");
  const approved = approvePlan(plan);
  const written = await writeJson(option(parsed, "out"), approved);
  result({
    command: "approve",
    artifact: written.path,
    approval_digest: approved.approval.digest,
  });
}

async function runCommand(parsed) {
  assertShape(parsed, { positionals: 1, required: ["trace"] });
  const plan = await readJson(parsed.positionals[0]);
  if (plan?.kind !== "plan" || plan?.ir_version !== "1.0") {
    requireKind(plan, "plan");
  }
  validateNativePlan(plan);
  if (!verifyPlanApproval(plan)) {
    throw cliError(
      "APPROVAL_REQUIRED",
      "The plan is unapproved or changed since approval.",
    );
  }
  const reservation = await reserveNewFile(option(parsed, "trace"));
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.on("SIGINT", abort);
  process.on("SIGTERM", abort);
  let trace;
  try {
    trace = await runApprovedPlan(plan, { signal: controller.signal });
    validateArtifact(trace);
  } catch (error) {
    await discardReservation(reservation);
    throw error;
  } finally {
    process.off("SIGINT", abort);
    process.off("SIGTERM", abort);
  }
  const written = await writeReservedJson(reservation, trace);
  if (trace.status !== "completed") {
    const code =
      trace.failure?.kind === "cli_missing"
        ? "CLI_MISSING"
        : {
            failed: "RUN_FAILED",
            cancelled: "RUN_CANCELLED",
            "protocol-error": "RUN_PROTOCOL_ERROR",
            truncated: "RUN_TRUNCATED",
          }[trace.status] ?? "RUN_FAILED";
    throw cliError(
      code,
      `Native run ended with status "${trace.status}"; the trace was saved.`,
      {
        artifact: written.path,
        status: trace.status,
        failure: trace.failure ?? null,
      },
    );
  }
  result({
    command: "run",
    artifact: written.path,
    status: trace.status,
    complete: trace.completeness === "complete",
  });
}

async function syncDirectory(path) {
  const directory = await open(path, "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

async function promoteCommand(parsed) {
  assertShape(parsed, {
    positionals: 1,
    required: ["name", "description", "out"],
  });
  const artifact = await readJson(parsed.positionals[0]);
  validateArtifact(artifact);
  const draft = promoteArtifact(artifact, {
    name: option(parsed, "name"),
    description: option(parsed, "description"),
  });
  const outputDirectory = resolve(option(parsed, "out"));
  let created = false;
  let temporary = null;
  let handle;
  try {
    await mkdir(outputDirectory, { mode: 0o700 });
    created = true;
    temporary = join(
      outputDirectory,
      `.SKILL.md.workflow-studio-${process.pid}-${Date.now()}.tmp`,
    );
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(draft.skill_markdown, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporary, join(outputDirectory, "SKILL.md"));
    temporary = null;
    await syncDirectory(outputDirectory);
    await syncDirectory(dirname(outputDirectory));
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    if (temporary) await rm(temporary, { force: true }).catch(() => {});
    if (created) await rm(outputDirectory, { recursive: true, force: true }).catch(() => {});
    if (error?.code === "EEXIST") {
      throw cliError(
        "OUTPUT_EXISTS",
        `Promotion output directory already exists: ${outputDirectory}`,
      );
    }
    throw error;
  }
  result({
    command: "promote",
    directory: outputDirectory,
    skill: join(outputDirectory, "SKILL.md"),
    derived_from: draft.derived_from,
  });
}

async function airCommand(parsed) {
  const [subcommand, ...positionals] = parsed.positionals;
  if (!subcommand || subcommand === "help") {
    process.stdout.write(HELP);
    return;
  }
  const nested = {
    command: `air ${subcommand}`,
    positionals,
    options: parsed.options,
  };
  const commands = {
    import: airImportCommand,
    validate: airValidateCommand,
    convert: airConvertCommand,
    migrate: airMigrateCommand,
    workbench: airWorkbenchCommand,
  };
  const command = commands[subcommand];
  if (!command) {
    throw cliError("UNKNOWN_COMMAND", `Unknown AIR command: ${subcommand}`);
  }
  await command(nested);
}

async function main(argv) {
  const parsed = parseCommand(argv);
  if (parsed.command === "help") {
    process.stdout.write(HELP);
    return;
  }
  if (parsed.options.has("help")) {
    process.stdout.write(HELP);
    return;
  }
  const commands = {
    import: importCommand,
    validate: validateCommand,
    edit: editCommand,
    diff: diffCommand,
    export: exportCommand,
    studio: studioCommand,
    plan: planCommand,
    approve: approveCommand,
    run: runCommand,
    promote: promoteCommand,
    air: airCommand,
  };
  const command = commands[parsed.command];
  if (!command) {
    throw cliError("UNKNOWN_COMMAND", `Unknown command: ${parsed.command}`);
  }
  await command(parsed);
}

export async function runWorkflowStudioCli(argv) {
  try {
    await main(argv);
  } catch (error) {
    const diagnostic = {
      ok: false,
      code: typeof error?.code === "string" ? error.code : "WORKFLOW_STUDIO_ERROR",
      message: error?.message ?? String(error),
    };
    if (error?.details !== undefined) diagnostic.details = error.details;
    process.stderr.write(`${JSON.stringify(diagnostic)}\n`);
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await runWorkflowStudioCli(process.argv.slice(2));
}
