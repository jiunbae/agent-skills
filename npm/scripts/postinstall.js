const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const https = require("https");

const PLATFORM_MAP = {
  "darwin-arm64": "aarch64-apple-darwin",
  "darwin-x64": "x86_64-apple-darwin",
  "linux-x64": "x86_64-unknown-linux-musl",
  "linux-arm64": "aarch64-unknown-linux-musl",
};

const platform = `${process.platform}-${process.arch}`;
const rustTarget = PLATFORM_MAP[platform];

if (!rustTarget) {
  console.warn(`[agt] Unsupported platform: ${platform}`);
  process.exit(0);
}

// Check if binary already exists (from optionalDependencies)
const binDir = path.join(__dirname, "..", "bin");
const binPath = path.join(binDir, "agt");

try {
  // Try resolving from optional dependency
  const pkg = `@open330/agt-${platform}`;
  require.resolve(`${pkg}/bin/agt`);
  // Binary available via optional dep, nothing to do
  process.exit(0);
} catch {}

// Binary not found via optionalDependencies — download from GitHub releases
const pkg = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")
);
const version = `v${pkg.version}`;
const repo = "jiunbae/agent-skills";
const asset = `agt-${rustTarget}.tar.gz`;
const url = `https://github.com/${repo}/releases/download/${version}/${asset}`;

console.log(`[agt] Downloading binary for ${platform}...`);

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const follow = (url) => {
      https
        .get(url, { headers: { "User-Agent": "agt-postinstall" } }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            follow(res.headers.location);
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error(`Download failed: HTTP ${res.statusCode}`));
            return;
          }
          const file = fs.createWriteStream(dest);
          res.pipe(file);
          file.on("finish", () => {
            file.close();
            resolve();
          });
        })
        .on("error", reject);
    };
    follow(url);
  });
}

async function main() {
  const tmp = path.join(binDir, `agt-${platform}.tar.gz`);

  try {
    fs.mkdirSync(binDir, { recursive: true });
    await download(url, tmp);
    execSync(`tar -xzf "${tmp}" -C "${binDir}"`, { stdio: "pipe" });
    fs.chmodSync(binPath, 0o755);
    fs.unlinkSync(tmp);
    console.log(`[agt] Binary installed successfully.`);
  } catch (e) {
    console.warn(`[agt] Failed to download binary: ${e.message}`);
    console.warn(`[agt] You can install manually from: ${url}`);
    // Don't fail install — binary is optional enhancement
    try { fs.unlinkSync(tmp); } catch {}
  }
}

main();
