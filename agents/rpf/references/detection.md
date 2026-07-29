# RPF detection catalogs

Used by pre-loop setup. RPF never invents a gate or a deploy command: it runs
what the repository already defines. These catalogs exist so that "detect what
exists" does not silently degrade into "found nothing, so nothing to run".

Report what was detected — and what was looked for but absent — before cycle 1.

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
equivalent elsewhere); fall back to a plain question when none exists.

**Question 1 — timing.** Show the detected targets in the question body, then
offer exactly:

1. `After all iterations finish (recommended)` → `DEPLOY_MODE = end-only`
2. `Every iteration` → `DEPLOY_MODE = per-cycle`
3. `Do not deploy` → `DEPLOY_MODE = none`

**Question 2 — command.** Only for `end-only` or `per-cycle`. Offer the
concrete commands implied by the detected targets as options, plus a free-form
escape. Store the answer verbatim as `DEPLOY_CMD`; do not normalize or
"improve" it.

Announce `POINTER_DOC`, cycle budget, resume count, `GATES`, `DEPLOY_MODE`, and
`DEPLOY_CMD` before cycle 1.
