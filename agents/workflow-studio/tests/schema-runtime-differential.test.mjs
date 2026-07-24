import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { isDeepStrictEqual } from "node:util";

import {
  AIR_CONTENT_DOMAIN,
  AIR_PROFILES,
  canonicalizeJcs,
} from "../shared/air-codec.mjs";
import {
  createSessionAirArtifact,
  validateAirArtifact,
} from "../src/air.mjs";

const COMPONENT = resolve(import.meta.dirname, "..");
const SCHEMA_FILES = [
  "air.schema.json",
  "air-workflow.schema.json",
  "air-plan.schema.json",
  "air-trace.schema.json",
];

const SCHEMA_KEYWORDS = new Set([
  "$schema",
  "$id",
  "$ref",
  "$defs",
  "title",
  "description",
  "contentEncoding",
  "format",
  "type",
  "const",
  "enum",
  "required",
  "properties",
  "propertyNames",
  "additionalProperties",
  "unevaluatedProperties",
  "items",
  "prefixItems",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minLength",
  "maxLength",
  "pattern",
  "minimum",
  "maximum",
  "allOf",
  "anyOf",
  "oneOf",
  "if",
  "then",
  "else",
]);

function pointer(path, key) {
  const token = String(key).replaceAll("~", "~0").replaceAll("/", "~1");
  return `${path}/${token}`;
}

function scanSchema(schema, path = "#") {
  if (typeof schema === "boolean") return;
  assert.equal(
    schema !== null && typeof schema === "object" && !Array.isArray(schema),
    true,
    `${path} must be a schema object or boolean`,
  );
  for (const key of Object.keys(schema)) {
    assert.equal(
      SCHEMA_KEYWORDS.has(key),
      true,
      `${path} uses unsupported schema keyword ${JSON.stringify(key)}`,
    );
  }
  for (const [key, child] of Object.entries(schema.$defs ?? {})) {
    scanSchema(child, pointer(`${path}/$defs`, key));
  }
  for (const [key, child] of Object.entries(schema.properties ?? {})) {
    scanSchema(child, pointer(`${path}/properties`, key));
  }
  for (const key of [
    "propertyNames",
    "additionalProperties",
    "unevaluatedProperties",
    "items",
    "if",
    "then",
    "else",
  ]) {
    if (schema[key] !== undefined && typeof schema[key] !== "boolean") {
      scanSchema(schema[key], `${path}/${key}`);
    }
  }
  for (const key of ["prefixItems", "allOf", "anyOf", "oneOf"]) {
    for (const [index, child] of (schema[key] ?? []).entries()) {
      scanSchema(child, `${path}/${key}/${index}`);
    }
  }
}

function jsonType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
}

function result(errors = [], evaluated = new Set()) {
  return { valid: errors.length === 0, errors, evaluated };
}

function mergeEvaluated(target, source) {
  for (const key of source) target.add(key);
}

function resolveJsonPointer(document, fragment) {
  if (fragment === "") return document;
  assert.match(fragment, /^\/(?:.*)$/u, `unsupported schema fragment #${fragment}`);
  return fragment
    .slice(1)
    .split("/")
    .map((token) => token.replaceAll("~1", "/").replaceAll("~0", "~"))
    .reduce((value, token) => {
      assert.equal(
        value !== null && typeof value === "object" &&
          Object.hasOwn(value, token),
        true,
        `unresolved schema pointer #${fragment}`,
      );
      return value[token];
    }, document);
}

function createSchemaEvaluator(documents) {
  const registry = new Map(documents.map((document) => [document.$id, document]));

  function resolveReference(reference, baseId) {
    const absolute = new URL(reference, baseId);
    const documentId = `${absolute.origin}${absolute.pathname}${absolute.search}`;
    const document = registry.get(documentId);
    assert.ok(document, `unregistered schema reference ${documentId}`);
    return {
      schema: resolveJsonPointer(
        document,
        decodeURIComponent(absolute.hash.slice(1)),
      ),
      baseId: documentId,
    };
  }

  function evaluate(instance, schema, baseId, instancePath = "$") {
    if (schema === true) return result();
    if (schema === false) return result([`${instancePath}: false schema`]);

    const errors = [];
    const evaluated = new Set();
    const append = (child, { annotations = true } = {}) => {
      errors.push(...child.errors);
      if (annotations && child.valid) mergeEvaluated(evaluated, child.evaluated);
    };

    if (schema.$ref !== undefined) {
      const target = resolveReference(schema.$ref, baseId);
      append(evaluate(instance, target.schema, target.baseId, instancePath));
    }

    if (schema.type !== undefined) {
      const expected = Array.isArray(schema.type) ? schema.type : [schema.type];
      const actual = jsonType(instance);
      const matches = expected.some((type) =>
        type === actual || (type === "number" && actual === "integer"));
      if (!matches) {
        errors.push(
          `${instancePath}: expected ${expected.join("|")}, received ${actual}`,
        );
      }
    }
    if (schema.const !== undefined && !isDeepStrictEqual(instance, schema.const)) {
      errors.push(`${instancePath}: const mismatch`);
    }
    if (
      schema.enum !== undefined &&
      !schema.enum.some((candidate) => isDeepStrictEqual(instance, candidate))
    ) {
      errors.push(`${instancePath}: enum mismatch`);
    }

    if (instance !== null && typeof instance === "object" && !Array.isArray(instance)) {
      for (const required of schema.required ?? []) {
        if (!Object.hasOwn(instance, required)) {
          errors.push(`${instancePath}: missing required property ${required}`);
        }
      }
      const declared = new Set(Object.keys(schema.properties ?? {}));
      for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
        if (!Object.hasOwn(instance, key)) continue;
        evaluated.add(key);
        append(
          evaluate(
            instance[key],
            childSchema,
            baseId,
            pointer(instancePath, key),
          ),
        );
      }
      if (schema.propertyNames !== undefined) {
        for (const key of Object.keys(instance)) {
          append(
            evaluate(
              key,
              schema.propertyNames,
              baseId,
              `${pointer(instancePath, key)}<name>`,
            ),
            { annotations: false },
          );
        }
      }
      if (schema.additionalProperties !== undefined) {
        for (const key of Object.keys(instance)) {
          if (declared.has(key)) continue;
          evaluated.add(key);
          if (schema.additionalProperties === false) {
            errors.push(`${pointer(instancePath, key)}: additional property`);
          } else if (schema.additionalProperties !== true) {
            append(
              evaluate(
                instance[key],
                schema.additionalProperties,
                baseId,
                pointer(instancePath, key),
              ),
            );
          }
        }
      }
    }

    if (Array.isArray(instance)) {
      if (schema.minItems !== undefined && instance.length < schema.minItems) {
        errors.push(`${instancePath}: fewer than ${schema.minItems} items`);
      }
      if (schema.maxItems !== undefined && instance.length > schema.maxItems) {
        errors.push(`${instancePath}: more than ${schema.maxItems} items`);
      }
      if (schema.uniqueItems === true) {
        for (let left = 0; left < instance.length; left += 1) {
          for (let right = left + 1; right < instance.length; right += 1) {
            if (isDeepStrictEqual(instance[left], instance[right])) {
              errors.push(`${instancePath}: duplicate items ${left} and ${right}`);
            }
          }
        }
      }
      const prefixLength = schema.prefixItems?.length ?? 0;
      for (let index = 0; index < Math.min(prefixLength, instance.length); index += 1) {
        append(
          evaluate(
            instance[index],
            schema.prefixItems[index],
            baseId,
            `${instancePath}/${index}`,
          ),
        );
      }
      if (schema.items !== undefined) {
        for (let index = prefixLength; index < instance.length; index += 1) {
          if (schema.items === false) {
            errors.push(`${instancePath}/${index}: item is not allowed`);
          } else if (schema.items !== true) {
            append(
              evaluate(
                instance[index],
                schema.items,
                baseId,
                `${instancePath}/${index}`,
              ),
            );
          }
        }
      }
    }

    if (typeof instance === "string") {
      const length = [...instance].length;
      if (schema.minLength !== undefined && length < schema.minLength) {
        errors.push(`${instancePath}: shorter than ${schema.minLength}`);
      }
      if (schema.maxLength !== undefined && length > schema.maxLength) {
        errors.push(`${instancePath}: longer than ${schema.maxLength}`);
      }
      if (schema.pattern !== undefined && !new RegExp(schema.pattern, "u").test(instance)) {
        errors.push(`${instancePath}: pattern mismatch`);
      }
      if (schema.format !== undefined) {
        assert.equal(schema.format, "uri", `unsupported format ${schema.format}`);
        try {
          new URL(instance);
        } catch {
          errors.push(`${instancePath}: URI format mismatch`);
        }
      }
    }

    if (typeof instance === "number" && Number.isFinite(instance)) {
      if (schema.minimum !== undefined && instance < schema.minimum) {
        errors.push(`${instancePath}: less than ${schema.minimum}`);
      }
      if (schema.maximum !== undefined && instance > schema.maximum) {
        errors.push(`${instancePath}: greater than ${schema.maximum}`);
      }
    }

    for (const childSchema of schema.allOf ?? []) {
      append(evaluate(instance, childSchema, baseId, instancePath));
    }
    for (const keyword of ["anyOf", "oneOf"]) {
      if (schema[keyword] === undefined) continue;
      const branches = schema[keyword].map((childSchema) =>
        evaluate(instance, childSchema, baseId, instancePath));
      const matching = branches.filter((branch) => branch.valid);
      const expected = keyword === "oneOf" ? matching.length === 1 : matching.length > 0;
      if (!expected) {
        errors.push(`${instancePath}: ${keyword} matched ${matching.length} branches`);
      } else {
        for (const branch of matching) mergeEvaluated(evaluated, branch.evaluated);
      }
    }
    if (schema.if !== undefined) {
      const condition = evaluate(instance, schema.if, baseId, instancePath);
      const selected = condition.valid ? schema.then : schema.else;
      if (selected !== undefined) {
        append(evaluate(instance, selected, baseId, instancePath));
      }
    }

    if (
      instance !== null &&
      typeof instance === "object" &&
      !Array.isArray(instance) &&
      schema.unevaluatedProperties !== undefined
    ) {
      for (const key of Object.keys(instance)) {
        if (evaluated.has(key)) continue;
        if (schema.unevaluatedProperties === false) {
          errors.push(`${pointer(instancePath, key)}: unevaluated property`);
        } else if (schema.unevaluatedProperties !== true) {
          append(
            evaluate(
              instance[key],
              schema.unevaluatedProperties,
              baseId,
              pointer(instancePath, key),
            ),
          );
        }
        evaluated.add(key);
      }
    }

    return result(errors, evaluated);
  }

  return {
    validate(instance, schemaId) {
      const schema = registry.get(schemaId);
      assert.ok(schema, `unknown root schema ${schemaId}`);
      return evaluate(instance, schema, schemaId);
    },
  };
}

function domainDigest(domain, value) {
  return createHash("sha256")
    .update(domain, "utf8")
    .update(canonicalizeJcs(value), "utf8")
    .digest("hex");
}

function resealContent(artifact) {
  const digest = domainDigest(AIR_CONTENT_DOMAIN, {
    format: artifact.format,
    air_version: artifact.air_version,
    kind: artifact.kind,
    profile: artifact.profile,
    body: artifact.body,
  });
  artifact.artifact_id = `urn:air:sha256:${digest}`;
  artifact.integrity.content_digest = digest;
  delete artifact.integrity.envelope_digest;
  return artifact;
}

function runtimeDisposition(artifact) {
  try {
    validateAirArtifact(artifact);
    return { valid: true, code: null };
  } catch (error) {
    return { valid: false, code: error?.code ?? error?.name ?? "UNKNOWN" };
  }
}

function emptySessionBody() {
  const emptyDigest = createHash("sha256").update(Buffer.alloc(0)).digest("hex");
  return {
    capture: {
      adapter: { id: "codex-rollout-jsonl", version: "1.0.0" },
      source_schema_fingerprint: "3".repeat(64),
      snapshot_cursor: { epoch: 0, byte_offset: 0 },
      completeness: "complete-prefix",
      source_prefix: { byte_length: 0, sha256: emptyDigest },
    },
    privacy: {
      profile: "metadata-only",
      redaction_manifest: [
        "prompt",
        "message",
        "reasoning",
        "command",
        "arguments",
        "results",
        "stdout",
        "stderr",
        "attachments",
        "file-content",
        "environment",
        "credentials",
        "paths",
        "branches",
        "provider-identifiers",
      ].map((category) => ({ category, disposition: "omitted", count: 0 })),
    },
    events: [],
    event_graph: { entry_event_ids: [], nodes: [], edges: [] },
    lifecycle: {
      state: "unknown",
      complete: false,
      confidence: {
        level: "unknown",
        rule_id: "session.lifecycle-unavailable",
        reason: "No authoritative provider lifecycle evidence is available.",
      },
      evidence: [],
    },
    diagnostics: [],
    hidden_reasoning_recovered: false,
  };
}

function sessionEventFixture({
  id = "event_AAAAAAAAAAAAAAAAAAAAAA",
  start = 0,
  end = 3,
} = {}) {
  return {
    id,
    order: 0,
    type: "record.observed",
    assertion: "observed",
    confidence: {
      level: "explicit",
      rule_id: "session.complete-jsonl-line",
      reason: "A complete newline-delimited source record was observed.",
    },
    evidence_refs: [],
    evidence: [{
      raw_type: "record.observed",
      top_level_keys: ["content-omitted"],
      byte_range: { start_byte: start, end_byte: end },
      byte_length: end - start,
      sha256: "4".repeat(64),
      omitted: true,
    }],
  };
}

function setSessionEvents(body, events, cursor) {
  body.capture.snapshot_cursor.byte_offset = cursor;
  body.events = events.map((event, order) => ({ ...event, order }));
  body.event_graph = {
    entry_event_ids: events.map((event) => event.id),
    nodes: events.map((event) => event.id),
    edges: [],
  };
}

test("published AIR schemas and runtime have an explicit bounded differential", async () => {
  const documents = await Promise.all(SCHEMA_FILES.map(async (name) =>
    JSON.parse(await readFile(resolve(COMPONENT, "schemas", name), "utf8"))));
  for (const document of documents) scanSchema(document);
  const evaluator = createSchemaEvaluator(documents);
  const rootSchemaId =
    "https://open330.github.io/air/schema/1.0.0/air.schema.json";

  const workflow = JSON.parse(await readFile(
    resolve(COMPONENT, "examples/hello-agent/workflow.air.json"),
    "utf8",
  ));
  const plan = JSON.parse(await readFile(
    resolve(COMPONENT, "examples/synthetic-plan.air.json"),
    "utf8",
  ));
  const nativeTrace = JSON.parse(await readFile(
    resolve(COMPONENT, "examples/synthetic-trace.air.json"),
    "utf8",
  ));
  const session = createSessionAirArtifact(emptySessionBody());

  const validArtifacts = [
    ["workflow deterministic golden", workflow],
    ["plan deterministic golden", plan],
    ["native trace deterministic golden", nativeTrace],
    ["session public-constructor golden", session],
  ];
  for (const [label, artifact] of validArtifacts) {
    const schema = evaluator.validate(artifact, rootSchemaId);
    assert.equal(schema.valid, true, `${label}: ${schema.errors.join("; ")}`);
    assert.deepEqual(
      runtimeDisposition(artifact),
      { valid: true, code: null },
      label,
    );
  }

  const atLimitCases = [
    {
      label: "envelope Unicode creator name counts code points",
      source: workflow,
      mutate(artifact, amount) {
        artifact.provenance.created_by.name = "😀".repeat(amount);
      },
      maximum: 256,
    },
    {
      label: "envelope migration warning length",
      source: workflow,
      mutate(artifact, amount) {
        artifact.provenance.migrations[0].warnings = ["x".repeat(amount)];
      },
      maximum: 4_096,
    },
    {
      label: "plan argv collection",
      source: plan,
      mutate(artifact, amount) {
        artifact.extensions = {};
        artifact.body.command.argv = Array.from({ length: amount }, () => "");
      },
      maximum: 128,
    },
    {
      label: "plan argv item length",
      source: plan,
      mutate(artifact, amount) {
        artifact.extensions = {};
        artifact.body.command.argv = ["x".repeat(amount)];
      },
      maximum: 8_192,
    },
    {
      label: "native trace adapter identifier length",
      source: nativeTrace,
      mutate(artifact, amount) {
        artifact.extensions = {};
        artifact.body.adapter.id = "x".repeat(amount);
      },
      maximum: 256,
    },
    {
      label: "native trace stdout byte ceiling",
      source: nativeTrace,
      mutate(artifact, amount) {
        artifact.extensions = {};
        artifact.body.process.stdout_bytes = amount;
      },
      maximum: 33_554_432,
    },
    {
      label: "session source-prefix byte ceiling",
      source: session,
      mutate(artifact, amount) {
        artifact.body.capture.snapshot_cursor.byte_offset = amount;
        artifact.body.capture.source_prefix.byte_length = amount;
      },
      maximum: 33_554_432,
      createBody(body, amount) {
        body.capture.snapshot_cursor.byte_offset = amount;
        body.capture.source_prefix.byte_length = amount;
      },
    },
  ];
  for (const scenario of atLimitCases) {
    const accepted = structuredClone(scenario.source);
    scenario.mutate(accepted, scenario.maximum);
    resealContent(accepted);
    const acceptedSchema = evaluator.validate(accepted, rootSchemaId);
    assert.equal(
      acceptedSchema.valid,
      true,
      `${scenario.label} at limit: ${acceptedSchema.errors.join("; ")}`,
    );
    assert.deepEqual(
      runtimeDisposition(accepted),
      { valid: true, code: null },
      `${scenario.label} at limit`,
    );

    const rejected = structuredClone(scenario.source);
    scenario.mutate(rejected, scenario.maximum + 1);
    resealContent(rejected);
    assert.equal(
      evaluator.validate(rejected, rootSchemaId).valid,
      false,
      `${scenario.label} limit + 1 schema`,
    );
    assert.equal(
      runtimeDisposition(rejected).valid,
      false,
      `${scenario.label} limit + 1 runtime`,
    );
    if (scenario.createBody) {
      const body = emptySessionBody();
      scenario.createBody(body, scenario.maximum + 1);
      assert.throws(
        () => createSessionAirArtifact(body),
        (error) => error?.code === "AIR_SEMANTIC_INVALID",
        `${scenario.label} public constructor`,
      );
    }
  }

  const schemaRepresentableNegatives = [
    {
      label: "workflow schema title pattern",
      source: workflow,
      mutate(artifact) {
        artifact.body.graph.nodes[0].title = "bad\nheading";
      },
    },
    {
      label: "plan schema command shell const",
      source: plan,
      mutate(artifact) {
        artifact.body.command.shell = true;
      },
    },
    {
      label: "native trace schema hidden-reasoning const",
      source: nativeTrace,
      mutate(artifact) {
        artifact.body.hidden_reasoning_recovered = true;
      },
    },
    {
      label: "session schema privacy profile const",
      source: session,
      mutate(artifact) {
        artifact.body.privacy.profile = "raw-content";
      },
      createBody(body) {
        body.privacy.profile = "raw-content";
      },
    },
    {
      label: "envelope created-by version maxLength",
      source: workflow,
      mutate(artifact) {
        artifact.provenance.created_by.version = "x".repeat(257);
      },
    },
    {
      label: "envelope origin format maxLength",
      source: workflow,
      mutate(artifact) {
        artifact.provenance.origins[0].format = "x".repeat(129);
      },
    },
    {
      label: "envelope origin version maxLength",
      source: workflow,
      mutate(artifact) {
        artifact.provenance.origins[0].version = "x".repeat(129);
      },
    },
    {
      label: "envelope origin locator maxLength",
      source: workflow,
      mutate(artifact) {
        artifact.provenance.origins[0].locator = {
          display: "x".repeat(4_097),
          disclosure: "local-only",
        };
      },
    },
    {
      label: "envelope migration field maxLength",
      source: workflow,
      mutate(artifact) {
        artifact.provenance.migrations[0].migrator = "x".repeat(257);
      },
    },
    {
      label: "workflow source identifier maxLength",
      source: workflow,
      mutate(artifact) {
        const id = "x".repeat(257);
        artifact.extensions = {};
        artifact.body.source.source_id = id;
        for (const mapping of artifact.body.source_maps) {
          mapping.source_id = id;
        }
      },
    },
    {
      label: "workflow node title maxLength",
      source: workflow,
      mutate(artifact) {
        artifact.extensions = {};
        artifact.body.graph.nodes[0].title = "x".repeat(8_193);
      },
    },
    {
      label: "workflow node identifier maxLength",
      source: workflow,
      mutate(artifact) {
        artifact.extensions = {};
        const prior = artifact.body.graph.nodes[0].id;
        const id = "x".repeat(257);
        artifact.body.graph.nodes[0].id = id;
        artifact.body.graph.entry_node_ids =
          artifact.body.graph.entry_node_ids.map((value) =>
            value === prior ? id : value);
        for (const edge of artifact.body.graph.edges) {
          if (edge.from === prior) edge.from = id;
          if (edge.to === prior) edge.to = id;
        }
        for (const mapping of artifact.body.source_maps) {
          if (mapping.node_id === prior) mapping.node_id = id;
        }
      },
    },
    {
      label: "workflow edge identifier maxLength",
      source: workflow,
      mutate(artifact) {
        artifact.extensions = {};
        artifact.body.graph.edges[0].id = "x".repeat(257);
      },
    },
    {
      label: "workflow evidence item maxLength",
      source: workflow,
      mutate(artifact) {
        artifact.extensions = {};
        artifact.body.graph.nodes[0].evidence_refs = ["x".repeat(257)];
      },
    },
    {
      label: "workflow opaque reason maxLength",
      source: workflow,
      mutate(artifact) {
        artifact.extensions = {};
        artifact.body.opaque_ranges[0].reason = "x".repeat(4_097);
      },
    },
    {
      label: "diagnostic code pattern",
      source: workflow,
      mutate(artifact) {
        artifact.extensions = {};
        artifact.body.diagnostics = [{
          severity: "warning",
          code: "x",
          message: "invalid code fixture",
          targets: [],
        }];
      },
    },
    {
      label: "diagnostic message maxLength",
      source: workflow,
      mutate(artifact) {
        artifact.extensions = {};
        artifact.body.diagnostics = [{
          severity: "warning",
          code: "AIR_LIMIT_TEST",
          message: "x".repeat(4_097),
          targets: [],
        }];
      },
    },
    {
      label: "native trace adapter version maxLength",
      source: nativeTrace,
      mutate(artifact) {
        artifact.extensions = {};
        artifact.body.adapter.version = "x".repeat(129);
      },
    },
    {
      label: "native trace event type maxLength",
      source: nativeTrace,
      mutate(artifact) {
        artifact.extensions = {};
        artifact.body.events[0].type = "x".repeat(257);
      },
    },
    {
      label: "native trace event status maxLength",
      source: nativeTrace,
      mutate(artifact) {
        artifact.extensions = {};
        artifact.body.events[0].status = "x".repeat(129);
      },
    },
    {
      label: "native trace event evidence maxItems zero",
      source: nativeTrace,
      mutate(artifact) {
        artifact.extensions = {};
        artifact.body.events[0].evidence_refs = ["evidence"];
      },
    },
    {
      label: "native trace failure kind maxLength",
      source: nativeTrace,
      mutate(artifact) {
        artifact.extensions = {};
        artifact.body.terminal = {
          status: "failed",
          completeness: "partial",
          failure: { kind: "x".repeat(257) },
        };
      },
    },
    {
      label: "session event order maximum",
      source: session,
      mutate(artifact) {
        const event = sessionEventFixture();
        artifact.body.capture.snapshot_cursor.byte_offset = 3;
        artifact.body.events = [{ ...event, order: 30_000 }];
        artifact.body.event_graph = {
          entry_event_ids: [event.id],
          nodes: [event.id],
          edges: [],
        };
      },
    },
    {
      label: "session event identifier pattern",
      source: session,
      mutate(artifact) {
        const event = sessionEventFixture({
          id: "event_invalid",
        });
        setSessionEvents(artifact.body, [event], 3);
      },
    },
    {
      label: "session edge identifier pattern",
      source: session,
      mutate(artifact) {
        const first = sessionEventFixture({
          id: "event_AAAAAAAAAAAAAAAAAAAAAA",
          start: 0,
          end: 3,
        });
        const second = sessionEventFixture({
          id: "event_BBBBBBBBBBBBBBBBBBBBBB",
          start: 3,
          end: 6,
        });
        setSessionEvents(artifact.body, [first, second], 6);
        artifact.body.event_graph.entry_event_ids = [first.id];
        artifact.body.event_graph.edges = [{
          id: "edge_invalid",
          from: first.id,
          to: second.id,
          kind: "temporal",
          assertion: "inferred",
          confidence: {
            level: "structural",
            rule_id: "session.file-order",
            reason: "Only newline record order is inferred.",
          },
          evidence_refs: [],
        }];
      },
    },
    {
      label: "session observed range maximum",
      source: session,
      mutate(artifact) {
        const event = sessionEventFixture();
        event.evidence[0].byte_range = {
          start_byte: 0,
          end_byte: 33_554_433,
        };
        event.evidence[0].byte_length = 33_554_433;
        artifact.body.capture.snapshot_cursor.byte_offset = 33_554_433;
        artifact.body.events = [event];
        artifact.body.event_graph = {
          entry_event_ids: [event.id],
          nodes: [event.id],
          edges: [],
        };
      },
    },
  ];
  for (const scenario of schemaRepresentableNegatives) {
    const artifact = structuredClone(scenario.source);
    scenario.mutate(artifact);
    resealContent(artifact);
    const schema = evaluator.validate(artifact, rootSchemaId);
    const runtime = runtimeDisposition(artifact);
    assert.equal(
      schema.valid,
      false,
      `${scenario.label}: schema was expected to reject`,
    );
    assert.equal(
      runtime.valid,
      false,
      `${scenario.label}: runtime was expected to reject`,
    );
    if (scenario.createBody) {
      const body = emptySessionBody();
      scenario.createBody(body);
      assert.throws(
        () => createSessionAirArtifact(body),
        (error) => error?.code === "AIR_SEMANTIC_INVALID",
        `${scenario.label}: public session constructor was expected to reject`,
      );
    }
  }

  const semanticOnlyNegatives = [
    {
      label: "workflow node order is not its array position",
      source: workflow,
      mutate(artifact) {
        artifact.body.graph.nodes[0].order = 1;
      },
    },
    {
      label: "plan agent and executable disagree",
      source: plan,
      mutate(artifact) {
        artifact.body.command.executable =
          artifact.body.agent === "codex" ? "claude" : "codex";
      },
    },
    {
      label: "completed native trace has a nonzero exit",
      source: nativeTrace,
      mutate(artifact) {
        artifact.body.process.exit_code = 7;
      },
    },
    {
      label: "active session carries idle process evidence",
      source: session,
      mutate(artifact) {
        artifact.body.lifecycle = {
          state: "active",
          complete: false,
          confidence: {
            level: "explicit",
            rule_id: "session.process-identity",
            reason: "Process identity and start identity were verified.",
          },
          evidence: [{
            source: "process-liveness",
            signal: "process-identity-verified-idle",
            observed: true,
            confidence: {
              level: "explicit",
              rule_id: "session.process-identity",
              reason: "Provider-specific process evidence was verified.",
            },
          }],
        };
      },
      createBody(body) {
        body.lifecycle = {
          state: "active",
          complete: false,
          confidence: {
            level: "explicit",
            rule_id: "session.process-identity",
            reason: "Process identity and start identity were verified.",
          },
          evidence: [{
            source: "process-liveness",
            signal: "process-identity-verified-idle",
            observed: true,
            confidence: {
              level: "explicit",
              rule_id: "session.process-identity",
              reason: "Provider-specific process evidence was verified.",
            },
          }],
        };
      },
    },
    {
      label: "session evidence extends beyond snapshot cursor",
      source: session,
      mutate(artifact) {
        setSessionEvents(
          artifact.body,
          [sessionEventFixture({ start: 0, end: 3 })],
          2,
        );
      },
      createBody(body) {
        setSessionEvents(
          body,
          [sessionEventFixture({ start: 0, end: 3 })],
          2,
        );
      },
    },
    {
      label: "session evidence ranges overlap",
      source: session,
      mutate(artifact) {
        setSessionEvents(artifact.body, [
          sessionEventFixture({
            id: "event_AAAAAAAAAAAAAAAAAAAAAA",
            start: 0,
            end: 3,
          }),
          sessionEventFixture({
            id: "event_BBBBBBBBBBBBBBBBBBBBBB",
            start: 2,
            end: 5,
          }),
        ], 5);
      },
      createBody(body) {
        setSessionEvents(body, [
          sessionEventFixture({
            id: "event_AAAAAAAAAAAAAAAAAAAAAA",
            start: 0,
            end: 3,
          }),
          sessionEventFixture({
            id: "event_BBBBBBBBBBBBBBBBBBBBBB",
            start: 2,
            end: 5,
          }),
        ], 5);
      },
    },
    {
      label: "session evidence ranges reverse source order",
      source: session,
      mutate(artifact) {
        setSessionEvents(artifact.body, [
          sessionEventFixture({
            id: "event_AAAAAAAAAAAAAAAAAAAAAA",
            start: 3,
            end: 5,
          }),
          sessionEventFixture({
            id: "event_BBBBBBBBBBBBBBBBBBBBBB",
            start: 0,
            end: 3,
          }),
        ], 5);
      },
    },
    {
      label: "session evidence ranges duplicate",
      source: session,
      mutate(artifact) {
        setSessionEvents(artifact.body, [
          sessionEventFixture({
            id: "event_AAAAAAAAAAAAAAAAAAAAAA",
            start: 0,
            end: 3,
          }),
          sessionEventFixture({
            id: "event_BBBBBBBBBBBBBBBBBBBBBB",
            start: 0,
            end: 3,
          }),
        ], 3);
      },
    },
    {
      label: "session source prefix exceeds snapshot cursor",
      source: session,
      mutate(artifact) {
        artifact.body.capture.snapshot_cursor.byte_offset = 2;
        artifact.body.capture.source_prefix.byte_length = 3;
      },
      createBody(body) {
        body.capture.snapshot_cursor.byte_offset = 2;
        body.capture.source_prefix.byte_length = 3;
      },
    },
  ];
  for (const scenario of semanticOnlyNegatives) {
    const artifact = structuredClone(scenario.source);
    scenario.mutate(artifact);
    resealContent(artifact);
    const schema = evaluator.validate(artifact, rootSchemaId);
    const runtime = runtimeDisposition(artifact);
    assert.equal(
      schema.valid,
      true,
      `${scenario.label}: schema intentionally accepts this envelope; ` +
        schema.errors.join("; "),
    );
    assert.equal(
      runtime.valid,
      false,
      `${scenario.label}: runtime semantics were expected to reject`,
    );
    assert.equal(
      runtime.code,
      "AIR_SEMANTIC_INVALID",
      `${scenario.label}: explicit semantic disposition`,
    );
    if (scenario.createBody) {
      const body = emptySessionBody();
      scenario.createBody(body);
      assert.throws(
        () => createSessionAirArtifact(body),
        (error) => error?.code === "AIR_SEMANTIC_INVALID",
        `${scenario.label}: public session constructor was expected to reject`,
      );
    }
  }

  const workflowCollectionLimits = [
    {
      label: "workflow nodes",
      maximum: 30_000,
      mutate(artifact, values) {
        artifact.body.graph.nodes = values;
      },
    },
    {
      label: "workflow edges",
      maximum: 30_000,
      mutate(artifact, values) {
        artifact.body.graph.edges = values;
      },
    },
    {
      label: "workflow entry IDs",
      maximum: 30_000,
      mutate(artifact, values) {
        artifact.body.graph.entry_node_ids = values;
      },
    },
    {
      label: "workflow source maps",
      maximum: 30_000,
      mutate(artifact, values) {
        artifact.body.source_maps = values;
      },
    },
    {
      label: "workflow opaque ranges",
      maximum: 60_001,
      mutate(artifact, values) {
        artifact.body.opaque_ranges = values;
      },
    },
    {
      label: "workflow diagnostics",
      maximum: 10_000,
      mutate(artifact, values) {
        artifact.body.diagnostics = values;
      },
    },
    {
      label: "workflow node evidence refs",
      maximum: 1_000,
      mutate(artifact, values) {
        artifact.body.graph.nodes[0].evidence_refs = values;
      },
    },
    {
      label: "workflow edge evidence refs",
      maximum: 1_000,
      mutate(artifact, values) {
        artifact.body.graph.edges[0].evidence_refs = values;
      },
    },
    {
      label: "workflow diagnostic targets",
      maximum: 1_000,
      mutate(artifact, values) {
        artifact.body.diagnostics = [{
          severity: "warning",
          code: "AIR_TEST_LIMIT",
          message: "Collection limit fixture.",
          targets: values,
        }];
      },
    },
  ];
  const workflowSchema = documents.find((document) =>
    document.$id.endsWith("/workflow.schema.json"));
  assert.equal(
    workflowSchema.$defs.graph.properties.nodes.maxItems,
    30_000,
  );
  assert.equal(
    workflowSchema.$defs.graph.properties.edges.maxItems,
    30_000,
  );
  assert.equal(
    workflowSchema.$defs.graph.properties.entry_node_ids.maxItems,
    30_000,
  );
  assert.equal(
    workflowSchema.$defs.workflowBody.properties.source_maps.maxItems,
    30_000,
  );
  assert.equal(
    workflowSchema.$defs.workflowBody.properties.opaque_ranges.maxItems,
    60_001,
  );
  assert.equal(
    workflowSchema.$defs.workflowBody.properties.diagnostics.maxItems,
    10_000,
  );
  assert.equal(
    workflowSchema.$defs.node.properties.evidence_refs.maxItems,
    1_000,
  );
  assert.equal(
    workflowSchema.$defs.edge.properties.evidence_refs.maxItems,
    1_000,
  );
  const envelopeSchema = documents.find((document) =>
    document.$id.endsWith("/air.schema.json"));
  assert.equal(
    envelopeSchema.$defs.diagnostic.properties.targets.maxItems,
    1_000,
  );
  for (const scenario of workflowCollectionLimits) {
    const artifact = structuredClone(workflow);
    scenario.mutate(
      artifact,
      Array.from({ length: scenario.maximum + 1 }, () => null),
    );
    resealContent(artifact);
    assert.throws(
      () => validateAirArtifact(artifact),
      (error) =>
        error?.code === "AIR_SEMANTIC_INVALID" &&
        error.message.includes(`at most ${scenario.maximum} items`),
      scenario.label,
    );
  }

  assert.equal(session.profile, AIR_PROFILES.session);
});
