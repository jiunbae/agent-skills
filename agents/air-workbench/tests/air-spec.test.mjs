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
  for (const [name, schema] of Object.entries(openapi.components.schemas)) {
    if (!/^Session/u.test(name)) continue;
    const properties = Object.keys(schema.properties ?? {});
    assert.deepEqual(
      properties.filter((key) => /(^|_)(path|paths|relative_path)$/u.test(key)),
      [],
      `session schema ${name} must not publish a path-like field`,
    );
  }
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
