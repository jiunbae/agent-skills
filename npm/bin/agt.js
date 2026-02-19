#!/usr/bin/env node

const { execFileSync } = require("child_process");
const path = require("path");

const PLATFORM_MAP = {
  "darwin-arm64": "@open330/agt-darwin-arm64",
  "darwin-x64": "@open330/agt-darwin-x64",
  "linux-x64": "@open330/agt-linux-x64",
  "linux-arm64": "@open330/agt-linux-arm64",
};

const platform = `${process.platform}-${process.arch}`;
const binName = process.platform === "win32" ? "agt.exe" : "agt";

let binary;

// Try platform-specific optional dependency
const pkg = PLATFORM_MAP[platform];
if (pkg) {
  try {
    binary = require.resolve(`${pkg}/bin/${binName}`);
  } catch {}
}

// Fallback: binary downloaded by postinstall
if (!binary) {
  binary = path.join(__dirname, binName);
}

try {
  execFileSync(binary, process.argv.slice(2), { stdio: "inherit" });
} catch (e) {
  if (e.status !== undefined) {
    process.exit(e.status);
  }
  console.error(`Failed to run agt: ${e.message}`);
  process.exit(1);
}
