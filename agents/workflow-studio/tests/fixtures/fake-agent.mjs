#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const fixtureDirectory = dirname(fileURLToPath(import.meta.url));

if (process.argv.includes("--version")) {
  process.stdout.write("fake-agent 1.2.3\n");
  process.exit(0);
}

let stdin = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) stdin += chunk;

if (process.env.FAKE_AGENT_AUDIT) {
  writeFileSync(
    process.env.FAKE_AGENT_AUDIT,
    JSON.stringify(
      {
        argv: process.argv.slice(2),
        cwd: process.cwd(),
        stdin,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
}

const scenario = process.env.FAKE_AGENT_SCENARIO ?? "codex-complete";
if (scenario === "cancel") {
  setInterval(() => {
    process.stdout.write('{"type":"thread.started"}\n');
  }, 25);
} else if (scenario === "oversized") {
  process.stdout.write(`${"x".repeat(4096)}\n`);
  process.stdout.write('{"type":"turn.completed"}\n');
} else if (scenario === "truncated") {
  process.stdout.write(`${"x".repeat(300 * 1024)}\n`);
  process.stdout.write('{"type":"turn.completed"}\n');
} else if (scenario === "stderr-overflow") {
  process.stderr.write("e".repeat(4096));
  process.stdout.write('{"type":"turn.completed"}\n');
} else if (scenario === "partial") {
  process.stdout.write('{"type":"thread.started"}\n{"type":"turn.comp');
} else if (scenario === "deep-event") {
  process.stdout.write(
    `{"type":"future.provider.event","deep":${"[".repeat(12_000)}0${"]".repeat(12_000)}}\n`,
  );
  process.stdout.write('{"type":"turn.completed"}\n');
} else if (scenario === "codex-unknown-secret") {
  process.stdout.write(
    '{"type":"future.provider.event","secret":"DO_NOT_PROMOTE_RAW"}\n',
  );
  process.stdout.write('{"type":"turn.completed"}\n');
} else {
  const fixtureName = `events-${scenario}.jsonl`;
  process.stdout.write(readFileSync(join(fixtureDirectory, fixtureName)));
  if (scenario === "codex-nonzero") process.exitCode = 7;
}
