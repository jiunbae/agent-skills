import { timingSafeEqual, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { isIP } from "node:net";
import { isAbsolute, resolve } from "node:path";

import { AIR_PROFILES, parseIJson } from "../shared/air-codec.mjs";
import { CATALOG_LIMITS } from "./catalog.mjs";

const DEFAULT_HOST = "127.0.0.1";
const WILDCARD_IPV4_HOST = "0.0.0.0";
const MAX_ARTIFACT_BYTES = 32 * 1024 * 1024;
const MAX_SESSION_REQUEST_BYTES = 4 * 1024;
const SESSION_REQUEST_TIMEOUT_MS = 2_000;
const MAX_CONCURRENT_SESSION_REQUESTS = 4;
const SNAPSHOT_ID_PATTERN = /^snapshot_[A-Za-z0-9_-]{22}$/u;
const SCHEMA_FILES = new Map([
  ["air", "air.schema.json"],
  ["workflow", "air-workflow.schema.json"],
  ["plan", "air-plan.schema.json"],
  ["trace", "air-trace.schema.json"],
  ["problem", "air-problem.schema.json"],
]);

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
  [
    "/generated/graph-canvas.mjs",
    {
      file: "generated/graph-canvas.mjs",
      type: "text/javascript; charset=utf-8",
    },
  ],
  [
    "/generated/graph-canvas.css",
    {
      file: "generated/graph-canvas.css",
      type: "text/css; charset=utf-8",
    },
  ],
]);

const SECURITY_HEADERS = Object.freeze({
  "Cache-Control": "no-store",
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
});

function assertBindHost(host) {
  if (
    host !== "127.0.0.1" &&
    host !== "::1" &&
    host !== WILDCARD_IPV4_HOST
  ) {
    throw new TypeError(
      'Studio host must be "127.0.0.1", "::1", or the explicit LAN bind "0.0.0.0".',
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

function hostHeaderAllowed(address, bindHost, header) {
  if (typeof header !== "string") return false;
  if (bindHost !== WILDCARD_IPV4_HOST) {
    return header === expectedHostHeader(address);
  }

  const match = /^([^:]+):([0-9]+)$/u.exec(header);
  if (!match || Number(match[2]) !== address.port) return false;
  return isIP(match[1]) === 4;
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

function encodeJson(value) {
  const bytes = Buffer.from(JSON.stringify(value), "utf8");
  if (bytes.byteLength > MAX_ARTIFACT_BYTES) {
    throw new RangeError("AIR response exceeds the bounded response limit.");
  }
  return bytes;
}

function problem(code, status, title, detail) {
  const value = {
    type: `https://open330.github.io/air/problems/${code
      .toLowerCase()
      .replaceAll("_", "-")}`,
    title,
    status,
    code,
  };
  if (detail) value.detail = detail;
  return encodeJson(value);
}

function sendProblem(response, method, code, status, title, detail, headers = {}) {
  send(response, method, status, problem(code, status, title, detail), {
    "Content-Type": "application/problem+json; charset=utf-8",
    ...headers,
  });
}

function exactToken(url, token, allowedQuery = new Set()) {
  if (
    [...url.searchParams.keys()].some(
      (key) => key !== "token" && !allowedQuery.has(key),
    ) ||
    url.searchParams.getAll("token").length !== 1
  ) {
    return false;
  }
  return tokenMatches(url.searchParams.get("token"), token);
}

function exactMediaType(value) {
  return (
    typeof value === "string" &&
    /^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(value)
  );
}

function readBoundedBody(request) {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks = [];
    let byteLength = 0;
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      request.off("aborted", onAborted);
      request.off("data", onData);
      request.off("end", onEnd);
      request.off("error", onError);
      callback(value);
    };
    const fail = (code, message) => {
      const error = new Error(message);
      error.code = code;
      finish(rejectPromise, error);
      request.resume();
    };
    const onAborted = () => fail(
      "AIR_SESSION_INVALID_REQUEST",
      "The request body was interrupted.",
    );
    const onError = () => fail(
      "AIR_SESSION_INVALID_REQUEST",
      "The request body could not be read.",
    );
    const onData = (chunk) => {
      byteLength += chunk.byteLength;
      if (byteLength > MAX_SESSION_REQUEST_BYTES) {
        fail(
          "AIR_REQUEST_TOO_LARGE",
          `The request body exceeds ${MAX_SESSION_REQUEST_BYTES} bytes.`,
        );
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => finish(resolvePromise, Buffer.concat(chunks));
    const timer = setTimeout(() => {
      fail("AIR_REQUEST_TIMEOUT", "The request body timed out.");
    }, SESSION_REQUEST_TIMEOUT_MS);
    timer.unref?.();
    request.on("aborted", onAborted);
    request.on("error", onError);
    request.on("data", onData);
    request.on("end", onEnd);
  });
}

function sessionRequestBody(bytes) {
  const value = parseIJson(bytes, {
    maxBytes: MAX_SESSION_REQUEST_BYTES,
    maxDepth: 4,
    maxItems: 8,
  });
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !Number.isInteger(value.generation) ||
    value.generation < 1 ||
    Object.keys(value).some(
      (key) => key !== "generation" && key !== "prior_snapshot_id",
    ) ||
    (
      value.prior_snapshot_id !== undefined &&
      (
        typeof value.prior_snapshot_id !== "string" ||
        !SNAPSHOT_ID_PATTERN.test(value.prior_snapshot_id)
      )
    )
  ) {
    const error = new Error(
      "Snapshot requests require a positive integer generation and optional opaque prior_snapshot_id.",
    );
    error.code = "AIR_SESSION_INVALID_REQUEST";
    throw error;
  }
  return value;
}

function sessionErrorResponse(response, method, error) {
  const responses = {
    AIR_SESSION_INVALID_REQUEST: [
      400,
      "Invalid session request",
    ],
    AIR_INVALID_JSON: [
      400,
      "Invalid JSON request",
    ],
    AIR_STRUCTURE_LIMIT: [
      400,
      "Invalid JSON request",
    ],
    AIR_REQUEST_TOO_LARGE: [
      413,
      "Request too large",
    ],
    AIR_REQUEST_TIMEOUT: [
      408,
      "Request timeout",
    ],
    AIR_SESSION_NOT_FOUND: [
      404,
      "Session not found",
    ],
    AIR_SESSION_STALE_GENERATION: [
      409,
      "Session catalog changed",
    ],
    AIR_SESSION_STALE_SNAPSHOT: [
      409,
      "Session snapshot changed",
    ],
    AIR_SESSION_SOURCE_UNAVAILABLE: [
      409,
      "Session source unavailable",
    ],
    AIR_SESSION_BUSY: [
      503,
      "Session reader busy",
    ],
    AIR_SESSION_LIMIT: [
      413,
      "Session limit reached",
    ],
  };
  const match = responses[error?.code];
  if (!match) return false;
  sendProblem(response, method, error.code, match[0], match[1]);
  return true;
}

/**
 * Create a read-only Workflow Studio server.
 *
 * The caller supplies an already-bounded artifact value. The server serializes
 * it once and exposes no write or run endpoint. The default is loopback; the
 * explicit 0.0.0.0 bind accepts only IPv4-literal Host headers on the bound
 * port so token URLs can be opened from the local network without accepting
 * arbitrary DNS Host values.
 */
export function createStudioServer({
  artifact,
  assetsDir,
  schemasDir,
  catalog = null,
  sessionRegistry = null,
  host = DEFAULT_HOST,
  port = 0,
} = {}) {
  assertBindHost(host);
  assertPort(port);
  if (typeof assetsDir !== "string" || assetsDir.length === 0) {
    throw new TypeError("Studio assetsDir must be a non-empty path string.");
  }

  const assetRoot = isAbsolute(assetsDir) ? assetsDir : resolve(assetsDir);
  const schemaRoot = typeof schemasDir === "string"
    ? (isAbsolute(schemasDir) ? schemasDir : resolve(schemasDir))
    : null;
  const artifactBytes = encodeArtifact(artifact);
  const token = randomBytes(32).toString("base64url");
  let permanentlyClosed = false;
  let activeSessionRequests = 0;

  const server = createServer(async (request, response) => {
    const address = server.address();
    if (
      !address ||
      typeof address === "string" ||
      !hostHeaderAllowed(address, host, request.headers.host)
    ) {
      send(response, request.method ?? "GET", 421, "Misdirected Request\n", {
        "Content-Type": "text/plain; charset=utf-8",
      });
      return;
    }

    const method = request.method ?? "GET";
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
      if (method !== "GET" && method !== "HEAD") {
        send(response, method, 405, "Method Not Allowed\n", {
          Allow: "GET, HEAD",
          "Content-Type": "text/plain; charset=utf-8",
        });
        return;
      }
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

    if (url.pathname.startsWith("/air/v1/")) {
      const skillsCatalogRoute = url.pathname === "/air/v1/skills";
      const sessionsCatalogRoute = url.pathname === "/air/v1/sessions";
      if (!exactToken(
        url,
        token,
        skillsCatalogRoute || sessionsCatalogRoute
          ? new Set(["refresh"])
          : new Set(),
      )) {
        sendProblem(
          response,
          method,
          "AIR_AUTH_REQUIRED",
          401,
          "Authentication required",
          "Exactly one valid Workbench token is required.",
          { "WWW-Authenticate": 'Bearer realm="air-workbench"' },
        );
        return;
      }

      const schemaMatch =
        /^\/air\/v1\/schemas\/1\.0\.0\/(air|workflow|plan|trace|problem)$/u
          .exec(url.pathname);
      const skillItemMatch =
        /^\/air\/v1\/skills\/(skill_[A-Za-z0-9_-]{22})\/artifact$/u
          .exec(url.pathname);
      const sessionSnapshotMatch =
        /^\/air\/v1\/sessions\/(session_[A-Za-z0-9_-]{22})\/snapshots$/u
          .exec(url.pathname);
      const knownRoute = (
        url.pathname === "/air/v1/capabilities" ||
        schemaMatch !== null ||
        skillsCatalogRoute ||
        skillItemMatch !== null ||
        sessionsCatalogRoute ||
        sessionSnapshotMatch !== null
      );
      if (!knownRoute) {
        sendProblem(
          response,
          method,
          "AIR_RESOURCE_NOT_FOUND",
          404,
          "Resource not found",
        );
        return;
      }

      const isSnapshotPost = sessionSnapshotMatch !== null;
      const allowedMethods = isSnapshotPost
        ? new Set(["POST"])
        : new Set(["GET", "HEAD"]);
      if (!allowedMethods.has(method)) {
        sendProblem(
          response,
          method,
          "AIR_METHOD_NOT_ALLOWED",
          405,
          "Method not allowed",
          isSnapshotPost
            ? "Session snapshot creation accepts POST only."
            : "This AIR route accepts GET and HEAD only.",
          { Allow: isSnapshotPost ? "POST" : "GET, HEAD" },
        );
        return;
      }

      if (
        (
          schemaMatch !== null &&
          schemaRoot === null
        ) ||
        (
          (skillsCatalogRoute || skillItemMatch !== null) &&
          catalog === null
        ) ||
        (
          (sessionsCatalogRoute || sessionSnapshotMatch !== null) &&
          sessionRegistry === null
        )
      ) {
        sendProblem(
          response,
          method,
          "AIR_RESOURCE_NOT_FOUND",
          404,
          "Resource not found",
        );
        return;
      }

      try {
        if (url.pathname === "/air/v1/capabilities") {
          const sessionAvailable = sessionRegistry !== null;
          const sessionCapabilities = sessionAvailable
            ? sessionRegistry.capabilities()
            : null;
          const sessionCatalog = !sessionAvailable
            ? null
            : await sessionRegistry.catalog();
          send(response, method, 200, encodeJson({
            api_version: "1",
            air_versions: ["1.0.0"],
            profiles: [
              AIR_PROFILES.workflow,
              AIR_PROFILES.plan,
              AIR_PROFILES.trace,
              AIR_PROFILES.session,
            ],
            operations: {
              "capabilities.read": "available",
              "schemas.read":
                schemaRoot === null ? "unavailable" : "available",
              "skills.catalog.read":
                catalog === null ? "unavailable" : "available",
              "skills.catalog.refresh":
                catalog === null ? "unavailable" : "available",
              "skills.artifact.read":
                catalog === null ? "unavailable" : "available",
              "sessions.catalog.read":
                sessionAvailable ? "available" : "unavailable",
              "sessions.snapshot.create":
                sessionAvailable ? "available" : "unavailable",
            },
            catalog_generation: catalog?.getSnapshot().generation ?? 0,
            session_generation: sessionCatalog?.generation ?? 0,
            provider_adapters: sessionCapabilities === null
              ? {
                  "codex-rollout-jsonl": "unavailable",
                  "claude-project-jsonl": "unavailable",
                }
              : Object.fromEntries(
                  sessionCapabilities.adapters.map(({ id }) => [id, "available"]),
                ),
            session_adapters: sessionCapabilities?.adapters ?? [],
            session_privacy_profile:
              sessionCapabilities?.privacy_profile ?? "unavailable",
            session_refresh:
              sessionCapabilities?.refresh ?? "unavailable",
            session_authority:
              sessionCapabilities?.authority ?? "unavailable",
            read_only: true,
            write: false,
            run: false,
            limits: {
              artifact_response_bytes: MAX_ARTIFACT_BYTES,
              catalog_max_roots: CATALOG_LIMITS.maxRoots,
              catalog_max_depth: CATALOG_LIMITS.maxDepth,
              catalog_max_entries: CATALOG_LIMITS.maxEntries,
              catalog_max_candidates: CATALOG_LIMITS.maxCandidates,
              catalog_max_records: CATALOG_LIMITS.maxRecords,
              catalog_max_skill_bytes: CATALOG_LIMITS.maxSkillBytes,
              catalog_max_total_bytes: CATALOG_LIMITS.maxTotalBytes,
              catalog_max_duration_ms: CATALOG_LIMITS.maxDurationMs,
              catalog_max_description_bytes:
                CATALOG_LIMITS.maxDescriptionBytes,
              catalog_max_diagnostics_per_item:
                CATALOG_LIMITS.maxDiagnosticsPerItem,
              catalog_max_response_bytes: CATALOG_LIMITS.maxCatalogBytes,
            },
            session_limits: {
              ...(sessionCapabilities?.limits ?? {}),
              session_request_max_bytes: MAX_SESSION_REQUEST_BYTES,
              session_request_timeout_ms: SESSION_REQUEST_TIMEOUT_MS,
              session_request_concurrency: MAX_CONCURRENT_SESSION_REQUESTS,
            },
          }), {
            "Content-Type": "application/json; charset=utf-8",
          });
          return;
        }
        if (schemaMatch) {
          const body = await readFile(resolve(
            schemaRoot,
            SCHEMA_FILES.get(schemaMatch[1]),
          ));
          send(response, method, 200, body, {
            "Content-Type": "application/schema+json; charset=utf-8",
          });
          return;
        }
        if (url.pathname === "/air/v1/skills") {
          const refresh = url.searchParams.getAll("refresh");
          if (
            refresh.length > 1 ||
            (refresh.length === 1 && refresh[0] !== "1")
          ) {
            sendProblem(
              response,
              method,
              "AIR_INVALID_REQUEST",
              400,
              "Invalid request",
              'The optional refresh query must be exactly "1".',
            );
            return;
          }
          if (method === "HEAD" && refresh.length === 1) {
            sendProblem(
              response,
              method,
              "AIR_INVALID_REQUEST",
              400,
              "Invalid refresh request",
              "HEAD never refreshes the catalog.",
            );
            return;
          }
          const snapshot = refresh.length === 1
            ? await catalog.refresh()
            : catalog.getSnapshot();
          send(response, method, 200, encodeJson(snapshot), {
            "Content-Type": "application/json; charset=utf-8",
          });
          return;
        }
        if (skillItemMatch) {
          const air = await catalog.importAirArtifact(skillItemMatch[1]);
          send(response, method, 200, encodeJson(air), {
            "Content-Type":
              `application/json; profile="${AIR_PROFILES.workflow}"`,
          });
          return;
        }
        if (sessionsCatalogRoute) {
          const refresh = url.searchParams.getAll("refresh");
          if (
            refresh.length > 1 ||
            (refresh.length === 1 && refresh[0] !== "1")
          ) {
            sendProblem(
              response,
              method,
              "AIR_SESSION_INVALID_REQUEST",
              400,
              "Invalid session request",
            );
            return;
          }
          if (method === "HEAD" && refresh.length === 1) {
            sendProblem(
              response,
              method,
              "AIR_SESSION_INVALID_REQUEST",
              400,
              "Invalid refresh request",
              "HEAD never refreshes the session catalog.",
            );
            return;
          }
          const value = await sessionRegistry.catalog({
            refresh: refresh.length === 1,
          });
          send(response, method, 200, encodeJson(value), {
            "Content-Type": "application/json; charset=utf-8",
          });
          return;
        }
        if (sessionSnapshotMatch) {
          if (
            request.headers["content-encoding"] !== undefined ||
            !exactMediaType(request.headers["content-type"])
          ) {
            sendProblem(
              response,
              method,
              "AIR_SESSION_UNSUPPORTED_MEDIA",
              415,
              "Unsupported request media",
              "Use unencoded application/json in UTF-8.",
            );
            request.resume();
            return;
          }
          const declaredLength = request.headers["content-length"];
          if (
            declaredLength !== undefined &&
            (
              !/^(?:0|[1-9][0-9]*)$/u.test(declaredLength) ||
              Number(declaredLength) > MAX_SESSION_REQUEST_BYTES
            )
          ) {
            sendProblem(
              response,
              method,
              "AIR_REQUEST_TOO_LARGE",
              413,
              "Request too large",
            );
            request.resume();
            return;
          }
          if (activeSessionRequests >= MAX_CONCURRENT_SESSION_REQUESTS) {
            sendProblem(
              response,
              method,
              "AIR_SESSION_BUSY",
              503,
              "Session reader busy",
              undefined,
              { "Retry-After": "1" },
            );
            request.resume();
            return;
          }
          activeSessionRequests += 1;
          try {
            const requestBody = sessionRequestBody(
              await readBoundedBody(request),
            );
            const snapshot = await sessionRegistry.snapshot({
              sessionId: sessionSnapshotMatch[1],
              generation: requestBody.generation,
              priorSnapshotId: requestBody.prior_snapshot_id,
            });
            if (snapshot.source_changed) {
              sendProblem(
                response,
                method,
                "AIR_SESSION_SOURCE_CHANGED",
                409,
                "Session source changed",
              );
              return;
            }
            send(response, method, 200, encodeJson(snapshot), {
              "Content-Type":
                `application/json; profile="${AIR_PROFILES.session}"`,
            });
          } finally {
            activeSessionRequests -= 1;
          }
          return;
        }
      } catch (error) {
        if (error?.code === "AIR_CATALOG_ITEM_STALE") {
          sendProblem(
            response,
            method,
            "AIR_CATALOG_ITEM_CHANGED",
            409,
            "Catalog item changed",
          );
        } else if (error?.code === "AIR_CATALOG_ITEM_NOT_FOUND") {
          sendProblem(
            response,
            method,
            "AIR_RESOURCE_NOT_FOUND",
            404,
            "Resource not found",
          );
        } else if (!sessionErrorResponse(response, method, error)) {
          sendProblem(
            response,
            method,
            "AIR_INTERNAL_ERROR",
            500,
            "Internal server error",
          );
        }
      }
      return;
    }

    if (method !== "GET" && method !== "HEAD") {
      send(response, method, 405, "Method Not Allowed\n", {
        Allow: "GET, HEAD",
        "Content-Type": "text/plain; charset=utf-8",
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
  maxConcurrentSessionRequests: MAX_CONCURRENT_SESSION_REQUESTS,
  maxSessionRequestBytes: MAX_SESSION_REQUEST_BYTES,
  sessionRequestTimeoutMs: SESSION_REQUEST_TIMEOUT_MS,
});
