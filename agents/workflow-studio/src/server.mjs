import { timingSafeEqual, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { isAbsolute, resolve } from "node:path";

const DEFAULT_HOST = "127.0.0.1";
const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;

const ASSETS = new Map([
  ["/", { file: "index.html", type: "text/html; charset=utf-8" }],
  ["/index.html", { file: "index.html", type: "text/html; charset=utf-8" }],
  ["/styles.css", { file: "styles.css", type: "text/css; charset=utf-8" }],
  [
    "/editor.mjs",
    { file: "editor.mjs", type: "text/javascript; charset=utf-8" },
  ],
  [
    "/editor-model.mjs",
    { file: "editor-model.mjs", type: "text/javascript; charset=utf-8" },
  ],
]);

const SECURITY_HEADERS = Object.freeze({
  "Cache-Control": "no-store",
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
});

function assertLoopbackHost(host) {
  if (host !== "127.0.0.1" && host !== "::1") {
    throw new TypeError(
      'Studio host must be the loopback literal "127.0.0.1" or "::1".',
    );
  }
}

function assertPort(port) {
  if (
    !Number.isInteger(port) ||
    port < 0 ||
    port > 65_535
  ) {
    throw new TypeError("Studio port must be an integer from 0 through 65535.");
  }
}

function encodeArtifact(artifact) {
  let encoded;
  try {
    encoded = JSON.stringify(artifact);
  } catch (error) {
    throw new TypeError(`Studio artifact must be JSON serializable: ${error.message}`);
  }

  if (encoded === undefined) {
    throw new TypeError("Studio artifact must be a JSON value.");
  }

  const bytes = Buffer.from(encoded, "utf8");
  if (bytes.byteLength > MAX_ARTIFACT_BYTES) {
    throw new RangeError(
      `Studio artifact exceeds the ${MAX_ARTIFACT_BYTES}-byte response limit.`,
    );
  }
  return bytes;
}

function expectedHostHeader(address) {
  const literal = address.family === "IPv6" ? `[${address.address}]` : address.address;
  return `${literal}:${address.port}`;
}

function hasTraversalOrInvalidEncoding(rawTarget) {
  const rawPath = rawTarget.split("?", 1)[0];
  let decoded = rawPath;

  for (let index = 0; index < 3; index += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      return true;
    }
  }

  if (decoded.includes("\0")) return true;
  return decoded
    .replaceAll("\\", "/")
    .split("/")
    .some((segment) => segment === "..");
}

function tokenMatches(candidate, expected) {
  if (typeof candidate !== "string") return false;
  const actualBytes = Buffer.from(candidate, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return (
    actualBytes.byteLength === expectedBytes.byteLength &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}

function send(response, method, status, body, headers = {}) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body, "utf8");
  response.writeHead(status, {
    ...SECURITY_HEADERS,
    "Content-Length": bytes.byteLength,
    ...headers,
  });
  response.end(method === "HEAD" ? undefined : bytes);
}

/**
 * Create a read-only Workflow Studio server.
 *
 * The caller supplies an already-bounded artifact value. The server serializes
 * it once, binds only to a literal loopback address, and exposes no write or run
 * endpoint.
 */
export function createStudioServer({
  artifact,
  assetsDir,
  host = DEFAULT_HOST,
  port = 0,
} = {}) {
  assertLoopbackHost(host);
  assertPort(port);
  if (typeof assetsDir !== "string" || assetsDir.length === 0) {
    throw new TypeError("Studio assetsDir must be a non-empty path string.");
  }

  const assetRoot = isAbsolute(assetsDir) ? assetsDir : resolve(assetsDir);
  const artifactBytes = encodeArtifact(artifact);
  const token = randomBytes(32).toString("base64url");
  let permanentlyClosed = false;

  const server = createServer(async (request, response) => {
    const address = server.address();
    if (
      !address ||
      typeof address === "string" ||
      request.headers.host !== expectedHostHeader(address)
    ) {
      send(response, request.method ?? "GET", 421, "Misdirected Request\n", {
        "Content-Type": "text/plain; charset=utf-8",
      });
      return;
    }

    const method = request.method ?? "GET";
    if (method !== "GET" && method !== "HEAD") {
      send(response, method, 405, "Method Not Allowed\n", {
        Allow: "GET, HEAD",
        "Content-Type": "text/plain; charset=utf-8",
      });
      return;
    }

    const rawTarget = request.url ?? "/";
    if (hasTraversalOrInvalidEncoding(rawTarget)) {
      send(response, method, 400, "Invalid request path\n", {
        "Content-Type": "text/plain; charset=utf-8",
      });
      return;
    }

    let url;
    try {
      url = new URL(rawTarget, `http://${request.headers.host}`);
    } catch {
      send(response, method, 400, "Invalid request target\n", {
        "Content-Type": "text/plain; charset=utf-8",
      });
      return;
    }

    if (url.pathname === "/api/artifact") {
      const candidates = url.searchParams.getAll("token");
      if (candidates.length !== 1 || !tokenMatches(candidates[0], token)) {
        send(response, method, 401, "Invalid studio token\n", {
          "Content-Type": "text/plain; charset=utf-8",
          "WWW-Authenticate": 'Bearer realm="workflow-studio"',
        });
        return;
      }
      send(response, method, 200, artifactBytes, {
        "Content-Type": "application/json; charset=utf-8",
      });
      return;
    }

    const asset = ASSETS.get(url.pathname);
    if (!asset) {
      send(response, method, 404, "Not Found\n", {
        "Content-Type": "text/plain; charset=utf-8",
      });
      return;
    }

    try {
      const body = await readFile(resolve(assetRoot, asset.file));
      send(response, method, 200, body, { "Content-Type": asset.type });
    } catch (error) {
      if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
        send(response, method, 404, "Not Found\n", {
          "Content-Type": "text/plain; charset=utf-8",
        });
        return;
      }
      send(response, method, 500, "Unable to read bundled asset\n", {
        "Content-Type": "text/plain; charset=utf-8",
      });
    }
  });

  function address() {
    const value = server.address();
    return value && typeof value !== "string" ? value : null;
  }

  async function listen() {
    if (permanentlyClosed) {
      throw new Error("Studio server has been closed and cannot be restarted.");
    }
    if (server.listening) return address();

    await new Promise((resolvePromise, rejectPromise) => {
      const onError = (error) => {
        server.off("listening", onListening);
        rejectPromise(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolvePromise();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen({ host, port, exclusive: true });
    });
    return address();
  }

  async function close() {
    permanentlyClosed = true;
    if (!server.listening) return;
    await new Promise((resolvePromise, rejectPromise) => {
      server.close((error) => {
        if (error) rejectPromise(error);
        else resolvePromise();
      });
    });
  }

  return Object.freeze({ address, close, listen, token });
}

export const studioServerLimits = Object.freeze({
  maxArtifactBytes: MAX_ARTIFACT_BYTES,
});
