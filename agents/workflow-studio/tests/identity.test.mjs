import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageRoot = new URL("../", import.meta.url);
const repositoryRoot = new URL("../../..", import.meta.url);

async function text(relative, root = packageRoot) {
  return readFile(new URL(relative, root), "utf8");
}

test("AIR Workbench is the canonical public identity", async () => {
  const [skill, page, notices] = await Promise.all([
    text("SKILL.md"),
    text("assets/index.html"),
    text("THIRD_PARTY_NOTICES.md"),
  ]);

  assert.match(skill, /^name: air-workbench$/m);
  assert.match(skill, /^# AIR Workbench$/m);
  assert.match(page, /<title>AIR Workbench<\/title>/);
  assert.match(page, /<h1>AIR Workbench<\/h1>/);
  assert.match(notices, /^# AIR Workbench browser bundle/m);
});

test("private package metadata uses the AIR Workbench name", async () => {
  const packageJson = JSON.parse(await text("package.json"));
  const lock = JSON.parse(await text("package-lock.json"));

  assert.equal(packageJson.private, true);
  assert.equal(packageJson.name, "@agt/air-workbench-ui");
  assert.equal(lock.name, "@agt/air-workbench-ui");
  assert.equal(lock.packages[""].name, "@agt/air-workbench-ui");
});

test("documentation states AIR formats and legacy compatibility truthfully", async () => {
  const [skill, readme] = await Promise.all([
    text("SKILL.md"),
    text("README.md"),
  ]);

  for (const document of [skill, readme]) {
    assert.match(document, /\.air\.json/);
    assert.match(document, /\.air\.md/);
    assert.match(document, /Workflow IR `1\.0`/);
    assert.match(document, /`workflow-studio:v1`/);
    assert.match(document, /\/api\/artifact/);
    assert.match(document, /\/air\/v1/);
    assert.match(document, /not (?:an )?IANA/i);
  }

  assert.match(skill, /place the reviewed bytes at `<skill-directory>\/SKILL\.md`/);
  assert.match(skill, /node scripts\/air\.mjs workbench/);
  assert.match(skill, /Codex rollout streams/);
  assert.match(skill, /Claude main\/subagent streams/);
  assert.match(skill, /`hidden_reasoning_recovered` is always `false`/);
  assert.match(skill, /no watcher or live/);
  assert.match(readme, /do not discover that filename/);
  assert.match(readme, /node scripts\/air\.mjs workbench/);
  assert.match(readme, /four-region AIR Workbench/);
  assert.match(readme, /metadata-only, read-only/);
  assert.match(readme, /does not run an agent or grant native\s+approval/);
  assert.doesNotMatch(
    `${skill}\n${readme}`,
    /integrated Resources list is not implemented|later delivery waves/,
  );
});

test("root catalogs use the AIR name without changing catalog counts", async () => {
  const [english, korean] = await Promise.all([
    text("README.md", repositoryRoot),
    text("README_ko.md", repositoryRoot),
  ]);

  assert.match(english, /\| `air-workbench` \| AIR Skill workflow editing,/);
  assert.match(korean, /\| `air-workbench` \| AIR Skill 워크플로 편집/);
  assert.doesNotMatch(english, /\| `workflow-studio` \|/);
  assert.doesNotMatch(korean, /\| `workflow-studio` \|/);
  assert.match(english, /skills-31-/);
  assert.match(korean, /skills-31-/);
});
