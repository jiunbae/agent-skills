import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  cp,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { assertPackageNotices } from "../scripts/package-notices.mjs";

const COMPONENT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("exact package pins, lock digest, and production bundle notices agree", async () => {
  await assertPackageNotices();

  const fixture = await mkdtemp(join(tmpdir(), "air-package-notices-"));
  try {
    await Promise.all([
      cp(join(COMPONENT, "ui"), join(fixture, "ui"), { recursive: true }),
      cp(join(COMPONENT, "package.json"), join(fixture, "package.json")),
      cp(join(COMPONENT, "package-lock.json"), join(fixture, "package-lock.json")),
      cp(
        join(COMPONENT, "THIRD_PARTY_NOTICES.md"),
        join(fixture, "THIRD_PARTY_NOTICES.md"),
      ),
      symlink(join(COMPONENT, "node_modules"), join(fixture, "node_modules"), "dir"),
    ]);

    const packagePath = join(fixture, "package.json");
    const lockPath = join(fixture, "package-lock.json");
    const noticesPath = join(fixture, "THIRD_PARTY_NOTICES.md");
    const packageDocument = JSON.parse(await readFile(packagePath, "utf8"));
    const lockDocument = JSON.parse(await readFile(lockPath, "utf8"));
    packageDocument.dependencies = { classcat: "5.0.5" };
    lockDocument.packages[""].dependencies = { classcat: "5.0.5" };
    const lockSource = `${JSON.stringify(lockDocument, null, 2)}\n`;
    const digest = createHash("sha256").update(lockSource).digest("hex");
    const noticesSource = (await readFile(noticesPath, "utf8")).replace(
      /(?<=lock SHA-256 at review:\s*`)[a-f0-9]{64}(?=`)/,
      digest,
    );
    await Promise.all([
      writeFile(packagePath, `${JSON.stringify(packageDocument, null, 2)}\n`),
      writeFile(lockPath, lockSource),
      writeFile(noticesPath, noticesSource),
    ]);

    await assert.rejects(
      assertPackageNotices(fixture),
      /package\.json.*dependencies contains an unreviewed root dependency/,
    );

    delete packageDocument.dependencies;
    await writeFile(packagePath, `${JSON.stringify(packageDocument, null, 2)}\n`);
    await assert.rejects(
      assertPackageNotices(fixture),
      /package-lock\.json.*dependencies contains an unreviewed root dependency/,
    );
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
