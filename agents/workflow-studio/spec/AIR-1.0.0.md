# AIR 1.0.0

Status: project specification, 2026-07-24.

AIR is the **Agent Intermediate Representation** used by AIR Workbench. This
document defines AIR 1.0.0. AIR is a project format. It does not claim IANA
registration, standards-body status, trademark exclusivity, or compatibility
with unrelated formats named AIR.

The words MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD, SHOULD NOT,
RECOMMENDED, NOT RECOMMENDED, MAY, and OPTIONAL are to be interpreted as
described by RFC 2119 and RFC 8174 when shown in capitals.

## 1. Stable identifiers

| Purpose | Identifier |
|---|---|
| Specification | `https://open330.github.io/air/spec/1.0.0/` |
| Root schema | `https://open330.github.io/air/schema/1.0.0/air.schema.json` |
| Workflow schema | `https://open330.github.io/air/schema/1.0.0/workflow.schema.json` |
| Plan schema | `https://open330.github.io/air/schema/1.0.0/plan.schema.json` |
| Trace schema | `https://open330.github.io/air/schema/1.0.0/trace.schema.json` |
| Problem schema | `https://open330.github.io/air/schema/1.0.0/problem.schema.json` |
| Workflow profile | `https://open330.github.io/air/profiles/1.0.0/workflow-skill` |
| Plan profile | `https://open330.github.io/air/profiles/1.0.0/plan-native-cli` |
| Native trace profile | `https://open330.github.io/air/profiles/1.0.0/trace-native-run` |
| Session trace profile | `https://open330.github.io/air/profiles/1.0.0/trace-session-snapshot` |
| Problem types | `https://open330.github.io/air/problems/{lowercase-code}` |
| Local API major | `/air/v1` |

`.air.json` is the complete representation for every AIR kind. It is
`application/json` with the applicable profile URI supplied as a media-type
`profile` parameter when a transport supports parameters. `.air.md` is the
workflow-only, lossless Agent Skill carrier and is
`text/markdown; charset=utf-8`. AIR 1 does not define or claim a registered
`application/air+json`, `vnd.*`, or Markdown `variant` value.

## 2. Conformance

An AIR file MUST satisfy its Draft 2020-12 schema and the runtime requirements
in this document. Schema success alone is not conformance. Runtime validation
MUST additionally check:

- duplicate JSON member names, I-JSON and JCS input restrictions;
- content, artifact, envelope, source, opaque-range, and evidence digests;
- kind/profile agreement and extension support;
- unique IDs, valid endpoints, duplicate endpoint pairs, cycles, array order,
  graph entries, and source partition invariants;
- UTF-8 byte ranges, render/reimport equivalence, approval binding, trace
  terminal truth, session cursors, and metadata-only privacy.

All core objects are closed. Unknown members are invalid unless they occur
inside the root `extensions` map or an explicitly described opaque native-run
event source. Implementations MUST impose the limits published by
`GET /air/v1/capabilities`; the schemas publish the portable 32 MiB and
30,000-item ceilings.

## 3. Envelope and kinds

Every file has this shape:

```json
{
  "$schema": "https://open330.github.io/air/schema/1.0.0/air.schema.json",
  "format": "air",
  "air_version": "1.0.0",
  "kind": "workflow",
  "profile": "https://open330.github.io/air/profiles/1.0.0/workflow-skill",
  "artifact_id": "urn:air:sha256:<content-digest>",
  "body": {},
  "provenance": {
    "created_by": {"name": "air-workbench", "version": "1.0.0"},
    "origins": [],
    "derived_from": [],
    "migrations": []
  },
  "integrity": {
    "canonicalization": "RFC8785",
    "algorithm": "sha-256",
    "content_digest": "<64 lowercase hexadecimal characters>"
  },
  "required_extensions": [],
  "extensions": {}
}
```

All shown members are REQUIRED. `integrity.envelope_digest` is OPTIONAL.
`$schema` MAY be omitted only from an API response whose media profile
unambiguously supplies the same schema identity. Files MUST include it.

`kind` is exactly `workflow`, `plan`, or `trace`. A promoted trace or plan is a
workflow whose provenance records `promotion`; it is not a fourth kind.
Session snapshots are traces, not a `session` kind.

## 4. Profiles

### 4.1 Workflow Skill

The workflow body is exactly `source`, `graph`, `source_maps`,
`opaque_ranges`, and `diagnostics`, as closed by
`air-workflow.schema.json`.

`source.bytes_base64` is the complete authoritative UTF-8 Skill Markdown.
`source.sha256` is ordinary SHA-256 over those bytes. A local path is never
authority and is omitted by default; an optional locator is explicitly
`local-only` or `redacted`.

Nodes are declared `step` records in canonical array order. Edges are
`sequence` or `parallel` records and explicitly distinguish declared and
inferred assertions. Confidence never changes an assertion. Every byte range
is zero-based, half-open, and measured over UTF-8 bytes. Source-map spans plus
opaque ranges MUST form an exact, non-overlapping partition of the source.
Opaque hashes are ordinary SHA-256 over their exact ranges.

No-op render MUST return the authoritative source bytes exactly. Edited output
MUST validate and reimport to the same AIR workflow core projection. Canvas
positions, viewport, focus, selection, panel state, dirty state, and other
presentation data are not AIR core data.

### 4.2 Native CLI plan

The plan body embeds a complete AIR workflow and binds its content digest,
prompt bytes, rendered Skill bytes, agent, local cwd disclosure, provider
safety boundary, fixed shell-free command, execution mode, graph-enforcement
truth, warnings, and optional approval.

`execution_mode` is `native-cli-prompt-context` and `graph_enforcement` is
`prompt-context-only`. The graph is prompt context; AIR does not claim
deterministic node-by-node enforcement by the native agent.

Approval is:

```json
{
  "algorithm": "sha-256",
  "scope": "exact-native-run-envelope",
  "statement": "plan approved for native execution; graph not enforced",
  "digest": "<approval digest>"
}
```

Any mutation invalidates approval.

### 4.3 Native-run trace

A native trace records the workflow and plan content digests, provider,
provider-specific safety boundary, cwd, versioned adapter, bounded observed
events, event graph, process evidence, terminal truth, diagnostics, and
`hidden_reasoning_recovered:false`.

Provider-declared relations are `provider-link` edges with an `observed`
assertion. Chronological adjacency is a `temporal` edge with an `inferred`
assertion. A completed trace requires coherent zero-exit/no-signal evidence
and the provider's required terminal event; runtime validation enforces this.
Failure evidence is monotonic and MUST NOT be upgraded to completion.

### 4.4 Session-snapshot trace

A session snapshot MUST use `trace-session-snapshot`. It MUST NOT fabricate a
plan digest, cwd authorization, command, process exit, or terminal completion.
Its adapter ID is `codex-rollout-jsonl` or `claude-project-jsonl`, with an
adapter version, source-schema fingerprint, append-safe byte cursor, bounded
source-prefix digest, completeness, and explicit lifecycle evidence.

Privacy is always `metadata-only`. Event evidence may contain only an
adapter-owned generic record type, the fixed `content-omitted` marker, byte
range and length, digest, and `omitted:true`.
Prompt, message, reasoning, command, arguments, results, stdout/stderr,
attachments, file contents, environment, credentials, full paths, branches,
and raw provider IDs MUST NOT appear. Recent mtime alone is neither active nor
complete evidence. Lifecycle claims MUST retain their observed,
provider-declared, or inferred provenance.

The redaction manifest contains every privacy category defined by the trace
schema exactly once, in canonical schema order. Session adapters construct
public records only from adapter-owned literals; unknown provider types, keys,
identifiers, and errors are represented by generic omission records and are
never copied into AIR.

Codex session lifecycle is `unknown` unless a version-tested provider signal
establishes a narrower state. Claude lifecycle may be `active` or `idle` only
when injected process evidence verifies both process identity and start
identity; otherwise it is `unknown`. Modification time alone is never
lifecycle evidence.

Append state is server-private and binds the provider, stream kind, adapter
major, open-file identity, epoch, committed newline offset, a bounded head
fingerprint, and a bounded checkpoint ending at that offset. A torn suffix is
discarded and retried from the last committed newline. Truncation, replacement,
checkpoint mismatch, or adapter-major change returns a typed source change and
never joins observations from different source epochs. Public opaque snapshot
handles, not caller-supplied cursors or paths, select continuation state.
The stable session-ID registry retains only the bounded current catalog
generation; removed or truncated identities are pruned and are never aliased
to a different source.

## 5. Canonicalization and identity

AIR uses RFC 8785 JSON Canonicalization Scheme bytes over I-JSON-compatible
values. A parser MUST reject duplicate object names, invalid Unicode or lone
surrogates, non-finite numbers, and integers outside
`[-9007199254740991, 9007199254740991]`. Arrays retain order. Pretty JSON is
permitted, but identity always uses JCS.

The exact projections and domains are:

```text
content_projection =
  {format, air_version, kind, profile, body}

content_digest =
  hexlower(SHA-256(UTF8("AIR-CONTENT-V1\n") || JCS(content_projection)))

artifact_id =
  "urn:air:sha256:" || content_digest

approval_projection =
  {format, air_version, kind, profile, body_without_approval, scope, statement}

approval_digest =
  hexlower(SHA-256(UTF8("AIR-APPROVAL-V1\n") || JCS(approval_projection)))

envelope_projection =
  complete root after removing only integrity.envelope_digest

envelope_digest =
  hexlower(SHA-256(UTF8("AIR-ENVELOPE-V1\n") || JCS(envelope_projection)))
```

`$schema`, provenance, integrity, required extensions, and extensions are
envelope-bound but do not change core content identity. Raw source, opaque,
session-prefix, and event-evidence digests are ordinary SHA-256 and are
labelled by scope. Workflow IR 1.0 hashes remain
`workflow-studio-legacy-v1`; they are never reinterpreted as AIR/JCS hashes.

Canonicalization golden vector:

```text
projection JCS:
{"air_version":"1.0.0","body":{},"format":"air","kind":"workflow","profile":"https://open330.github.io/air/profiles/1.0.0/workflow-skill"}

content digest:
e2b5b24c5b0a20b6e26fde15b820228a995504a02e5c77ae7ea6778845cf8a39
```

Conformance tests MUST also cover Unicode member ordering, duplicate names,
unsafe integers, negative zero, and extension preservation.

## 6. Versions and extensions

`air_version` is release SemVer without prerelease or build metadata. This
specification accepts exactly `1.0.0`. Other AIR 1 patch or minor versions can
be inspected and value-preserved read-only, but mutation requires an exact
supported schema and all required extensions. An unknown major is bounded
metadata/download-only and otherwise produces
`AIR_UNSUPPORTED_VERSION`.

Extension keys are absolute HTTPS URIs or reverse-DNS owner names containing a
dot. Values are bounded JSON data. Extensions cannot shadow or change core
validation. `required_extensions` is a unique, lexicographically sorted list
of keys present in `extensions`. Unknown optional extensions are preserved as
JSON values. An unknown required extension permits bounded inspection and
exact download only; edit, render, approval, execution, promotion, and
migration fail with `AIR_REQUIRED_EXTENSION_UNSUPPORTED`.

## 7. `.air.md` carrier

`.air.md` exists only for the workflow-skill profile. The Markdown source is
the single editable truth. The file ends with exactly one verified, top-level,
column-zero line:

```text
<!-- air:v1 BASE64URL_NO_PADDING(JCS(carrier-manifest)) -->
```

followed by the carrier newline. `carrier-envelope` is the complete workflow
envelope except `body.source.bytes_base64`; byte length and source digest
remain present. `carrier-manifest` is the following closed object:

```text
{
  carrier:"air.md",
  carrier_version:"1",
  envelope_without_source_content:carrier-envelope,
  logical_source:{byte_length,sha256}
}
```

The logical source is the first `logical_source.byte_length` bytes and its
digest MUST equal `logical_source.sha256` and the source-elided envelope's
`body.source.sha256`. The remainder MUST be exactly the separator, carrier
line, and final newline.

The separator is one carrier newline if source already has a final newline,
otherwise two. The carrier newline is CRLF only when `source.newline` is
`crlf`; it is LF for `lf` or `mixed`. The parser reinserts the logical source
as base64 and verifies UTF-8, length, newline metadata, source hash, content
digest, artifact ID, optional envelope digest, schema, profile, runtime
semantics, and render/reimport equality.

Missing, duplicate recognized, nonterminal, nested, quoted, indented, fenced,
malformed, oversized, wrong-kind/profile, or digest-mismatched carriers are
invalid. Marker-looking ordinary Markdown remains source content. No HTML or
YAML execution is involved. A no-op `.air.md` round trip is byte-identical;
the verified terminal comment is inert when the complete carrier is copied to
`SKILL.md`.

Carrier split golden cases:

| Logical source | Declared newline/final | Separator before marker |
|---|---|---|
| UTF-8 `# 기술\n` | `lf` / true | `\n` |
| `# Demo\r\n` | `crlf` / true | `\r\n` |
| `# Demo` | `lf` / false | `\n\n` |

## 8. Legacy migration

Migration is explicit, deterministic, offline, no-overwrite, and
new-output-only. Input and same/existing outputs MUST be refused. No
wall-clock value is introduced unless it already exists in evidence.

- Workflow IR `1.0` workflow preserves authoritative source bytes, graph
  IDs/order/edges, current and exact accepted legacy title maps, opaque
  ranges, diagnostics, and labelled legacy hashes.
- A legacy plan embeds the migrated workflow and preserves prompt, Skill,
  safety, cwd, and command evidence. Active legacy approval is cleared.
  Historical approval may appear only as non-authorizing migration evidence.
- A legacy trace preserves observed/inferred/failure/terminal/truncation truth.
- Trusted `workflow-studio:v1` Markdown remains accepted unchanged by the
  legacy importer. Explicit migration creates a new `.air.md`.

Migration records are the closed records in `air.schema.json`. Unregistered
alternative names, extensions, URNs, and aliases are neither accepted nor
emitted.

## 9. Problems and local API

Errors use `application/problem+json` and
`https://open330.github.io/air/problems/{lowercase-code}`. Required members
are `type`, `title`, `status`, and `code`; sanitized `detail` and JSON
Pointer-addressed `errors` are optional. Details MUST NOT echo authentication
tokens, private locators, absolute paths, or omitted session content.

`air.openapi.json` defines the complete `/air/v1` surface. Every operation has
`x-air-capability` and `x-air-availability`; clients MUST use
`GET /air/v1/capabilities` instead of assuming a planned operation exists.
Unavailable operations MUST fail as a typed problem, not silently downgrade.

The browser never supplies filesystem paths, roots, globs, URLs, or output
destinations. Transform operations are in-memory and do not install or write
a Skill, mutate provider stores, or run an agent. Local servers use a
per-process token, exact Host validation, no-store responses, no CORS, and
loopback by default. Explicit `--host 0.0.0.0` is informed plaintext-LAN
consent; it does not weaken token, Host, disclosure, or response bounds.

## 10. Compatibility boundary

AIR is additive. Workflow IR `1.0`, its schema and hashes,
`workflow-studio:v1` Markdown, existing commands, and `/api/artifact` remain
immutable legacy behavior. `SKILL.md` remains the executable and distributable
native artifact for Codex and Claude. AIR Workbench never claims that an AIR
graph replaces the native agent runtime.
