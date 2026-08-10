#!/usr/bin/env bash
# Oh My Prompt: Claude Code Stop hook (response capture)
#
# Performance notes:
#   * Runs the heavy work in the background so the Stop hook returns in <20ms,
#     letting Claude Code accept the user's next prompt without waiting for
#     transcript parsing or omp ingest.
#   * Parses the transcript jsonl from the tail (chunked reverse read) instead
#     of slurping the whole file. Cost per turn is bounded by the size of the
#     last turn, not the whole session. Big sessions (10MB+) used to do O(N)
#     work per turn -> O(last turn) now.
#   * Maintains a per-session checkpoint at \$XDG_CACHE_HOME/omp/checkpoints
#     (default ~/.cache/omp/checkpoints) so repeated invocations on an
#     unchanged transcript exit immediately.
set -euo pipefail

OMP_BIN="${OMP_BIN:-omp}"

payload="$(cat || true)"
if [ -z "$payload" ]; then exit 0; fi

# Run the actual processing in the background and detach so this hook returns
# immediately. We use a subshell ( ... ) & rather than `bash -c` to avoid
# nesting another layer of quoting around the embedded NODESCRIPT heredoc.
(
  exec </dev/null >/dev/null 2>&1
  response=$(OMP_PAYLOAD="$payload" node << 'NODESCRIPT'
const fs = require("fs");
const path = require("path");
const os = require("os");

const p = JSON.parse(process.env.OMP_PAYLOAD);
if (p.hook_event_name !== "Stop") process.exit(0);
const sid = p.session_id;
const tp = p.transcript_path;
if (!sid || !tp) process.exit(0);

// --- Checkpoint: skip if transcript size unchanged since last successful run.
const cacheBase = process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
const ckptDir = path.join(cacheBase, "omp", "checkpoints");
// session_id is a UUID-ish string; sanitize defensively for filesystem.
const ckptFile = path.join(ckptDir, sid.replace(/[^A-Za-z0-9._-]/g, "_") + ".json");

let stat;
try { stat = fs.statSync(tp); } catch { process.exit(0); }
const fileSize = stat.size;
if (fileSize === 0) process.exit(0);

let prevSize = 0;
try {
  const prev = JSON.parse(fs.readFileSync(ckptFile, "utf-8"));
  if (prev && typeof prev.size === "number") prevSize = prev.size;
} catch (_) { /* no prior checkpoint */ }

// If the transcript has not grown since last time, nothing new to capture.
if (fileSize === prevSize) process.exit(0);

// --- Tail read: pull chunks from the end until we have the last user line
// plus all subsequent assistant lines. Bounded by the size of the last turn.
const CHUNK = 64 * 1024;
const fd = fs.openSync(tp, "r");
let buf = Buffer.alloc(0);
let pos = fileSize;

function isReal(entry) {
  if ((entry.type || entry.role) !== "user") return false;
  let c = entry.message && entry.message.content;
  if (c === undefined) c = entry.content;
  if (Array.isArray(c)) {
    c = c.filter(b => b && b.type === "text").map(b => b.text).join("\n");
    if (!c) return false;
  }
  if (typeof c !== "string") return false;
  const t = c.trim();
  if (!t) return false;
  if (t.startsWith("<local-command-")) return false;
  if (t.startsWith("<command-name>")) return false;
  if (t.startsWith("<task-notification>")) return false;
  if (t.startsWith("<system-reminder>")) return false;
  if (t.startsWith("This session is being continued")) return false;
  if (t.startsWith("Stop hook feedback:")) return false;
  if (t === "[Request interrupted by user]") return false;
  if (/^\s*(Claude Code|[\u2590\u259B])/.test(t)) return false;
  return true;
}

function extractText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.filter(b => b && b.type === "text").map(b => b.text).join("\n");
  }
  return "";
}

// Bound the size of tool_use.input we ship to omp ingest. A single Edit or
// WebFetch call can carry hundreds of KB; without this, JSON.stringify of the
// emitted payload can overflow the stdin pipe to the ingest process.
function clipToolInput(value) {
  const LIMIT = 32 * 1024;
  function walk(v) {
    if (typeof v === "string") {
      if (v.length <= LIMIT) return v;
      return v.slice(0, LIMIT) + "...[truncated " + (v.length - LIMIT) + " chars]";
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out = {};
      for (const k of Object.keys(v)) out[k] = walk(v[k]);
      return out;
    }
    return v;
  }
  return walk(value);
}

// Read backwards in CHUNK-sized blocks. After each chunk, split on newlines
// and try to parse complete lines (everything except the first/leftmost
// fragment, which may be partial until we read more). Stop as soon as the
// most-recent real user line has been seen.
let entries = []; // chronological order
let foundUser = false;
const MAX_READ = fileSize;
let totalRead = 0;

while (pos > 0 && totalRead < MAX_READ) {
  const readSize = Math.min(CHUNK, pos);
  pos -= readSize;
  const chunk = Buffer.alloc(readSize);
  fs.readSync(fd, chunk, 0, readSize, pos);
  buf = Buffer.concat([chunk, buf]);
  totalRead += readSize;

  // Split on newline. If we are not at the start of file, the first segment
  // may be partial -> keep it in buf for the next iteration.
  const text = buf.toString("utf-8");
  const lines = text.split("\n");
  let startIdx;
  if (pos === 0) {
    startIdx = 0;
    buf = Buffer.alloc(0);
  } else {
    // Hold back the first (possibly partial) line.
    startIdx = 1;
    buf = Buffer.from(lines[0], "utf-8");
  }
  const parsed = [];
  for (let i = startIdx; i < lines.length; i++) {
    const ln = lines[i];
    if (!ln) continue;
    let e;
    try { e = JSON.parse(ln); } catch (_) { continue; }
    parsed.push(e);
  }
  entries = parsed.concat(entries);

  for (let i = entries.length - 1; i >= 0; i--) {
    if (isReal(entries[i])) { foundUser = true; break; }
  }
  if (foundUser) break;
}
fs.closeSync(fd);

function writeCheckpoint() {
  try {
    fs.mkdirSync(ckptDir, { recursive: true });
    fs.writeFileSync(ckptFile, JSON.stringify({ size: fileSize }));
  } catch (_) { /* best effort */ }
}

if (!foundUser || entries.length === 0) {
  writeCheckpoint();
  process.exit(0);
}

let lastUserIdx = -1;
for (let i = entries.length - 1; i >= 0; i--) {
  if (isReal(entries[i])) { lastUserIdx = i; break; }
}
if (lastUserIdx === -1) { writeCheckpoint(); process.exit(0); }

const parts = [];
const toolList = [];
let toolSeq = 0;
let cwd = "";
for (let i = lastUserIdx + 1; i < entries.length; i++) {
  const e = entries[i];
  if ((e.type || e.role) !== "assistant") continue;
  const c = (e.message && e.message.content) || e.content;
  if (!c) continue;
  const t = extractText(c);
  if (t.trim()) parts.push(t);
  if (e.cwd) cwd = e.cwd;
  if (Array.isArray(c)) {
    for (const b of c) {
      if (b && b.type === "tool_use" && b.id && b.name) {
        toolList.push({
          tool_use_id: String(b.id),
          tool_name: String(b.name),
          input: clipToolInput(b.input || {}),
          sequence: toolSeq++,
          cwd: e.cwd || "",
        });
      }
    }
  }
}
if (parts.length === 0 && toolList.length === 0) {
  writeCheckpoint();
  process.exit(0);
}

const uc = (entries[lastUserIdx].message && entries[lastUserIdx].message.content) || entries[lastUserIdx].content;
const userText = typeof uc === "string" ? uc : "";

// Update checkpoint *before* emitting so a concurrent Stop firing for the
// same session bytes will short-circuit.
writeCheckpoint();

process.stdout.write(JSON.stringify({
  session_id: sid,
  role: "assistant",
  text: parts.join("\n\n"),
  user_prompt_text: userText,
  source: "claude-code",
  cli_name: "claude",
  cwd: cwd || p.cwd || "",
  project: p.project || "",
  capture_response: true,
  tools: toolList,
}));
NODESCRIPT
)
  if [ -n "$response" ]; then
    printf '%s\n' "$response" | "$OMP_BIN" ingest --stdin || true
  fi
) &
disown $! 2>/dev/null || true
exit 0
