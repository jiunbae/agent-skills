import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const ROOT = join(import.meta.dirname, "..");
const SCHEMAS = join(ROOT, "schemas");

test("AIR 1 schemas and OpenAPI publish one exact closed project contract", async () => {
  const files = (await readdir(SCHEMAS))
    .filter((name) => name.startsWith("air") && name.endsWith(".json"))
    .sort();
  assert.deepEqual(files, [
    "air-plan.schema.json",
    "air-problem.schema.json",
    "air-trace.schema.json",
    "air-workflow.schema.json",
    "air.openapi.json",
    "air.schema.json",
  ]);

  const documents = new Map(
    await Promise.all(
      files.map(async (name) => [
        name,
        JSON.parse(await readFile(join(SCHEMAS, name), "utf8")),
      ]),
    ),
  );
  assert.equal(
    documents.get("air.schema.json").$id,
    "https://open330.github.io/air/schema/1.0.0/air.schema.json",
  );
  assert.equal(
    documents.get("air-workflow.schema.json").$id,
    "https://open330.github.io/air/schema/1.0.0/workflow.schema.json",
  );
  assert.equal(
    documents.get("air-plan.schema.json").$id,
    "https://open330.github.io/air/schema/1.0.0/plan.schema.json",
  );
  assert.equal(
    documents.get("air-trace.schema.json").$id,
    "https://open330.github.io/air/schema/1.0.0/trace.schema.json",
  );

  const rootText = JSON.stringify(documents.get("air.schema.json"));
  assert.match(rootText, /"format":\{"const":"air"\}/);
  assert.match(rootText, /"air_version":\{"const":"1\.0\.0"\}/);
  assert.doesNotMatch(rootText, /awir/i);

  for (const name of [
    "air-workflow.schema.json",
    "air-plan.schema.json",
    "air-trace.schema.json",
    "air-problem.schema.json",
  ]) {
    assert.match(JSON.stringify(documents.get(name)), /unevaluatedProperties/);
  }

  const openapi = documents.get("air.openapi.json");
  assert.equal(openapi.openapi, "3.1.1");
  assert.equal(openapi.info.version, "1.2.0");
  assert.deepEqual(Object.keys(openapi.paths).sort(), [
    "/air/v1/capabilities",
    "/air/v1/imports/skill",
    "/air/v1/migrations",
    "/air/v1/renderings/skill",
    "/air/v1/schemas/{version}/{profile}",
    "/air/v1/sessions",
    "/air/v1/sessions/{opaque-id}/snapshots",
    "/air/v1/skills",
    "/air/v1/skills/{opaque-id}/artifact",
    "/air/v1/validate",
  ]);
  for (const pathItem of Object.values(openapi.paths)) {
    for (const operation of Object.values(pathItem)) {
      assert.match(operation["x-air-capability"], /^[a-z][a-z.]+$/);
      assert.ok(["foundation", "planned"].includes(operation["x-air-availability"]));
    }
  }
  const skillCatalog = openapi.components.schemas.SkillCatalog;
  const skillCatalogItem = openapi.components.schemas.SkillCatalogItem;
  assert.equal(skillCatalog.properties.version.const, "1.2.0");
  assert.equal(skillCatalogItem.required.includes("replaces_id"), false);
  assert.deepEqual(skillCatalogItem.properties.replaces_id, {
    type: "string",
    pattern: "^skill_[A-Za-z0-9_-]{22}$",
    description:
      "Opaque ID of the uniquely replaced item from the immediately preceding complete catalog generation. It is derived only from a mutually unique server-private source-authority relation, is omitted for ambiguity or incomplete authority, and is not a route alias.",
  });
  // The display-only label widens what the server discloses, never what the
  // client may submit, so it stays optional and the item stays closed.
  assert.equal(skillCatalogItem.unevaluatedProperties, false);
  assert.equal(skillCatalogItem.required.includes("relative_path"), false);
  assert.deepEqual(skillCatalogItem.properties.relative_path, {
    type: "string",
    minLength: 1,
    maxLength: 1024,
    description:
      "Display-only label, relative to the root that observed the record, published under the same local-only disclosure as an AIR locator. It is never authority, is never an addressable locator, and is never accepted as client input; selection remains by opaque item ID. The server emits it only when the relative form is non-empty, non-absolute, and free of \"..\", \".\", and empty segments, never publishes an absolute path or any path above the observing root, omits it rather than truncating or failing, and sheds it under response-byte pressure. It is identical on loopback and on an explicit --host 0.0.0.0 bind.",
  });
  // RPF-181: this assertion used to read only the top-level `properties` of
  // schemas whose *name* began with `Session`, which nine mutations out of ten
  // walked straight past: a nested object, an array item, a `$defs` entry, an
  // `allOf` branch, a differently-named schema pulled in by `$ref`, or the same
  // field spelled `directory` or `locator` — the two spellings `sessions.mjs`
  // actually uses internally. It now walks the whole schema graph reachable
  // from the session surface and checks a vocabulary, not one spelling.
  const PATH_LIKE = /(^|_)(paths?|dir|directory|directories|locator|root|roots|source_root|realpath|filename|file|cwd)$/u;
  const schemasByName = openapi.components.schemas;
  const sessionRoots = Object.keys(schemasByName).filter((name) =>
    /^Session/u.test(name),
  );
  assert.ok(sessionRoots.length >= 3, "the session surface must be non-trivial");

  const offenders = [];
  const visited = new Set();
  const walk = (node, trail) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const [index, entry] of node.entries()) {
        walk(entry, `${trail}[${index}]`);
      }
      return;
    }
    if (typeof node.$ref === "string") {
      const referenced = node.$ref.replace("#/components/schemas/", "");
      if (
        node.$ref.startsWith("#/components/schemas/") &&
        !visited.has(referenced)
      ) {
        visited.add(referenced);
        walk(schemasByName[referenced], `${trail} -> ${referenced}`);
      }
      return;
    }
    for (const key of ["properties", "patternProperties", "$defs"]) {
      for (const [name, child] of Object.entries(node[key] ?? {})) {
        if (key === "properties" && PATH_LIKE.test(name)) {
          offenders.push(`${trail}.${name}`);
        }
        walk(child, `${trail}.${name}`);
      }
    }
    for (const key of [
      "items",
      "additionalProperties",
      "unevaluatedProperties",
      "contains",
      "not",
      "if",
      "then",
      "else",
    ]) {
      if (typeof node[key] === "object") walk(node[key], `${trail}.${key}`);
    }
    for (const key of ["allOf", "anyOf", "oneOf", "prefixItems"]) {
      walk(node[key], `${trail}.${key}`);
    }
  };
  for (const name of sessionRoots) {
    visited.add(name);
    walk(schemasByName[name], name);
  }
  assert.deepEqual(
    offenders,
    [],
    `the session surface must publish no path-like field; found ${offenders.join(", ")}`,
  );
  const sessionItems =
    openapi.components.schemas.SessionCatalog.properties.items;
  assert.equal(sessionItems.uniqueItems, true);
  assert.match(
    sessionItems.description,
    /unique opaque id.*exactly one server-private source authority/,
  );
  const snapshotOperation =
    openapi.paths["/air/v1/sessions/{opaque-id}/snapshots"].post;
  assert.match(
    snapshotOperation.responses["200"].description,
    /per-registry domain-separated HMAC-SHA256 commitments/,
  );
  assert.match(
    openapi.components.schemas.SessionSnapshot.properties.artifact.description,
    /no ordinary SHA-256 digest of omitted provider bytes is exposed/,
  );
});

test("AIR normative text freezes domains, carriers, sessions, and legacy boundary", async () => {
  const spec = await readFile(join(ROOT, "spec/AIR-1.0.0.md"), "utf8");
  for (const required of [
    "AIR-CONTENT-V1\\n",
    "AIR-APPROVAL-V1\\n",
    "AIR-ENVELOPE-V1\\n",
    "<!-- air:v1 BASE64URL_NO_PADDING(JCS(carrier-manifest)) -->",
    "hidden_reasoning_recovered:false",
    "workflow-studio-legacy-v1",
    "project format",
    "does not claim IANA",
    "Every published session catalog row MUST have a unique opaque ID",
    "MUST be in source order, MUST NOT overlap",
    "last-published continuity high-water",
    "A public snapshot ID MUST NOT be reissued",
    "structurally claims the AIR-v1 carrier namespace",
    "AIR-SESSION-SOURCE-PREFIX-COMMITMENT-V1\\n",
    "AIR-SESSION-EVIDENCE-COMMITMENT-V1\\n",
    "UINT64BE(start_byte)",
    "A commitment is not an ordinary SHA-256 digest",
    "MUST differ across registry lifetimes",
    "The catalog item MAY contain `replaces_id`",
    "not a route alias",
    "The catalog item MAY contain a display-only relative label, `relative_path`",
    "MUST NOT emit an absolute path or\nany path above that root",
    "Session catalog rows MUST NOT carry any\npath-like field",
  ]) {
    assert.ok(spec.includes(required), `missing normative phrase: ${required}`);
  }
  assert.doesNotMatch(spec, /awir/i);
});
