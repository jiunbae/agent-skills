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
  ]) {
    assert.ok(spec.includes(required), `missing normative phrase: ${required}`);
  }
  assert.doesNotMatch(spec, /awir/i);
});
