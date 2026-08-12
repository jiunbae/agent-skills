# RPF detection catalogs

Used by pre-loop setup. RPF never invents a gate or a deploy command: it runs
what the repository already defines. These catalogs exist so that "detect what
exists" does not silently degrade into "found nothing, so nothing to run".

Report what was detected — and what was looked for but absent — before cycle 1.
Apply the secret-safe command preflight in `review-verification.md` while
detecting and before executing anything. Detection never authorizes reading an
environment file or printing environment values.
Run `runtime-contract.md` phase-zero classification before reading any signal
file content; inspect only approved bytes.

## Quality gates

Detect via config files and manifests, then resolve the exact command the
repository actually uses (`package.json` scripts, `Makefile` targets, `justfile`,
`tox.ini`, CI workflow steps) rather than a generic invocation.

| Class | Signals |
|---|---|
| Lint / format | `eslint.config.*`, `.eslintrc*`, `biome.json`, `.prettierrc*`, `ruff.toml`, `[tool.ruff]`, `[tool.black]`, `.rubocop.yml`, `.golangci.yml`, `clippy.toml`, `.shellcheckrc`, `.stylelintrc*`, `dprint.json` |
| Type check | `tsconfig.json` (`tsc --noEmit`), `mypy.ini`/`[tool.mypy]`, `pyrightconfig.json`, `sorbet/`, `flow-typed/` |
| Build / compile | `package.json` build script, `Cargo.toml`, `go.mod`, `Makefile`, `CMakeLists.txt`, `build.gradle*`, `pom.xml`, `pyproject.toml` build backend, `*.xcodeproj`, `Package.swift`, `build.zig` |
| Test | `jest.config.*`, `vitest.config.*`, `playwright.config.*`, `cypress.config.*`, `pytest.ini`/`[tool.pytest*]`, `tox.ini`, `go test` packages, `cargo test`, `*_test.go`, `spec/`, `tests/`, `__tests__/` |
| Repo-defined | `.pre-commit-config.yaml`, `lefthook.yml`, `.husky/`, CI workflow jobs that run checks |

Prefer the repository's own aggregate command when one exists (`make check`,
`npm run verify`, `pre-commit run --all-files`) over reconstructing the list.

Record the resolved list as `GATES`. Error-level failures are blocking in every
cycle. Missing tooling is reported, not silently skipped.

For each resolved command, run the secret-safe preflight before recording,
displaying, or injecting its free-form bytes, then classify it as `allowed`,
`not-run-prohibited`, or `not-run-unavailable` before execution. Reject a command that dumps the
environment, enables shell tracing, reads a raw credential file, interpolates a
potential secret into captured argv/output, or invokes a scanner that reports
unredacted matches. Resolve a documented redacting wrapper when one exists;
otherwise preserve the command as unavailable/unsafe and open a verification
gap rather than running it.

Secret safety overrides any requirement to record a prohibited command exactly.
When the preflight cannot clear it, replace only sensitive argument positions
with typed placeholders and persist that structurally exact redacted action,
an independently generated opaque incident ID, non-value source metadata, and a
coverage gap. Never persist, display, hash, or inject the raw value or any
value-derived fingerprint.

In full mode persist each classification and terminal result in the current
source fence's **Gate results** table. In audit mode construct the same rows in
memory and return them in the report without a pointer write. When detection
finds no configured gate, produce one explicit `not-applicable` detection row;
absence of rows is incomplete detection, not proof that no gate exists.
For every `not-run-prohibited` or `not-run-unavailable` row, record its complete
exact affected-contract ID list from the same inventory. The controller freezes
those current-fence gate rows with the changed/still-current contract inventory
inside one immutable captured-authority projection; reducers derive the
affected-contract mapping from that capture and never accept a caller-supplied
Boolean, subset, or empty replacement. Every `changed=true` contract remains
affected even when no gate exists or the detection row is `not-applicable`;
restricted gate links additionally make still-current contracts affected.

## Game and UI static exploration

For game repositories, seed the graph from manifests and entry scenes, then
follow every approved `res://` or engine asset reference, including scenes,
scripts, shaders/materials, meshes, audio, textures, animations, resources,
and configuration. Record unresolved referenced paths as frontier obligations;
an extension omitted from a narrow regex is not evidence that the frontier is
closed. Cover lifecycle, scenes, assets, input, state, physics/AI, combat,
economy/progression, save/load, network, UI, and platform variants separately.

Derive UI obligations per source surface, not as four global IDs. Treat common
component and interaction markers—including JSX/HTML containers, `onClick` or
keyboard handlers, `aria-*`, overflow/responsive styling, routes/navigation,
viewport/media queries, and screen/component names—as UI signals. Each detected
surface receives distinct route, viewport, interaction, variant,
mobile-layout, and accessibility IDs; multiple surfaces in one file remain
distinct; static
detection never claims runtime verification.

## Deployment targets

| Class | Signals |
|---|---|
| Container / build | `Dockerfile*`, `docker-compose*.y*ml`, `docker-bake.hcl` |
| Orchestrator | `k8s/**`, `**/charts/**`, `helmfile.y*ml`, `skaffold.y*ml`, `kustomization.y*ml` |
| PaaS | `fly.toml`, `render.yaml`, `railway.json`, `vercel.json`, `netlify.toml`, `Procfile`, `app.yaml`, `app.json` |
| Serverless / IaC | `serverless.y*ml`, `sam.yaml`, `samconfig.toml`, `template.yaml`, `cdk.json`, `*.tf`, `terraform/**`, `pulumi/**`, `ansible/**` |
| CI-as-deploy | `.github/workflows/*deploy*.y*ml` or `*release*.y*ml`, `.gitlab-ci.yml` deploy stages, `.circleci/config.yml` deploy jobs, `.buildkite/**` deploy steps |
| Scripts | `package.json` scripts matching `deploy\|release\|publish\|ship`, `Makefile` targets matching the same, `deploy.sh`, `release.sh`, `publish.sh` |
| Publishing | `pyproject.toml` publish config, `Cargo.toml` publishable crate, `package.json` without `"private": true`, `.npmrc` registry config |

An empty detection set means `DEPLOY_MODE = none` and `DEPLOY_CMD = ""`. Do not
ask the user about deployment in that case.

## Asking the user about deployment

Only when at least one target was detected, and only once, before cycle 1.
Use the host's structured question tool (`AskUserQuestion` on Claude Code, the
equivalent elsewhere). If none exists, ask only the timing question with the
three fixed options; do not create a free-form command intake.

**Question 1 — timing.** Show the detected targets in the question body, then
offer exactly:

1. `After all iterations finish (recommended)` → `DEPLOY_MODE = end-only`
2. `Every iteration` → `DEPLOY_MODE = per-cycle`
3. `Do not deploy` → `DEPLOY_MODE = none`

**Question 2 — command.** Only for `end-only` or `per-cycle`. Offer only the
concrete commands found in approved repository files. Secret-preflight every
option before showing it. Do not include a free-form escape in an ordinary
question/tool channel: those answer bytes reach the model before RPF can
preflight them. A free-form command is allowed only through a host API explicitly
documented as noncaptured and pre-model sanitizing. Without such an API,
require the user to add the command to an approved repository mechanism or set `DEPLOY_MODE = none`.
Store a selected safe repository command verbatim as
`DEPLOY_CMD`; do not normalize or improve it.

Announce `POINTER_DOC`, cycle budget, resume count, safe `GATES`, `DEPLOY_MODE`,
and only a preflight-cleared `DEPLOY_CMD`; otherwise announce the opaque
incident and gap without the action bytes.
