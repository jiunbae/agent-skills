#!/usr/bin/env python3
"""Run a prior committed RPF bootstrap when the loaded entry point is broken."""

from __future__ import annotations

import io
import json
import os
import re
import subprocess
import sys
import types
from contextlib import redirect_stdout
from pathlib import Path, PurePosixPath
from typing import Iterator, Sequence


BOOTSTRAP_PATH = "scripts/rpf_bootstrap.py"
MAX_BOOTSTRAP_BYTES = 16 * 1024 * 1024
MAX_ANCESTORS = 32


class RpfRescueError(RuntimeError):
    """Raised when no prior committed bootstrap can be executed safely."""


def _safe_git_environment() -> dict[str, str]:
    return {
        "PATH": "/usr/bin:/bin",
        "LANG": "C",
        "LC_ALL": "C",
        "GIT_CONFIG_GLOBAL": "/dev/null",
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_OPTIONAL_LOCKS": "0",
    }


def _git(arguments: Sequence[str], *, working_directory: Path) -> bytes:
    result = subprocess.run(
        ["git", "-c", "core.autocrlf=false", *arguments],
        cwd=working_directory,
        env=_safe_git_environment(),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
        timeout=10,
    )
    if result.returncode != 0:
        raise RpfRescueError("unable to read a prior committed RPF bootstrap")
    return result.stdout


def _prior_bootstraps(skill_directory: Path) -> Iterator[tuple[str, object]]:
    repository_root = Path(
        _git(("rev-parse", "--show-toplevel"), working_directory=skill_directory)
        .decode("utf-8", errors="strict")
        .strip()
    ).resolve(strict=True)
    try:
        skill_relative = skill_directory.relative_to(repository_root).as_posix()
    except ValueError as error:
        raise RpfRescueError("RPF rescue source identity is invalid") from error
    revisions = _git(
        (
            "rev-list",
            "--first-parent",
            f"--max-count={MAX_ANCESTORS}",
            "HEAD^",
        ),
        working_directory=repository_root,
    ).decode("ascii", errors="strict").splitlines()
    object_path = (PurePosixPath(skill_relative) / BOOTSTRAP_PATH).as_posix()
    for revision in revisions:
        if re.fullmatch(r"[0-9a-f]{40}", revision) is None:
            raise RpfRescueError("RPF rescue revision is invalid")
        try:
            data = _git(
                ("show", "--no-ext-diff", f"{revision}:{object_path}"),
                working_directory=repository_root,
            )
            if len(data) > MAX_BOOTSTRAP_BYTES:
                continue
            code = compile(
                data,
                f"<rescued-rpf-bootstrap>/{BOOTSTRAP_PATH}",
                "exec",
                dont_inherit=True,
            )
        except (RpfRescueError, SyntaxError, ValueError):
            continue
        yield revision, code


def _cli(argv: Sequence[str] | None = None) -> int:
    revision: str | None = None
    candidate_seen = False
    try:
        arguments = list(sys.argv[1:] if argv is None else argv)
        if not arguments or arguments[0] != "pin":
            raise RpfRescueError("RPF rescue supports only the pin operation")
        skill_directory = Path(__file__).resolve().parents[1]
        for index, (revision, code) in enumerate(_prior_bootstraps(skill_directory)):
            candidate_seen = True
            module_name = f"_rpf_rescued_bootstrap_{os.getpid()}_{index}"
            try:
                module = types.ModuleType(module_name)
                module.__file__ = os.fspath(skill_directory / BOOTSTRAP_PATH)
                module.__package__ = None
                sys.modules[module_name] = module
                exec(code, module.__dict__)
                bootstrap_cli = module.__dict__.get("_cli")
                if not callable(bootstrap_cli):
                    continue
                output = io.StringIO()
                with redirect_stdout(output):
                    status = bootstrap_cli(arguments)
                result = json.loads(output.getvalue())
                if (
                    not isinstance(result, dict)
                    or type(status) is not int
                    or status != 0
                    or result.get("status") != "ready"
                ):
                    continue
                result["rescue_source_kind"] = "git-ancestor-bootstrap"
                result["rescue_source_revision"] = revision
                print(json.dumps(result, ensure_ascii=True, sort_keys=True))
                return 0
            except Exception:
                continue
            finally:
                sys.modules.pop(module_name, None)
        if candidate_seen:
            raise RpfRescueError("no prior committed RPF bootstrap returned ready")
        raise RpfRescueError("no syntax-valid prior committed RPF bootstrap exists")
    except (
        OSError,
        UnicodeDecodeError,
        json.JSONDecodeError,
        RpfRescueError,
        subprocess.SubprocessError,
    ) as error:
        result = {
            "format": "rpf-pinned-bundle-v1",
            "status": "unavailable",
            "reason": str(error),
            "rescue_source_kind": "git-ancestor-bootstrap",
        }
        print(json.dumps(result, ensure_ascii=True, sort_keys=True))
        return 2
    except Exception:
        print(
            json.dumps(
                {
                    "format": "rpf-pinned-bundle-v1",
                    "status": "unavailable",
                    "reason": "RPF rescue encountered an internal failure",
                    "rescue_source_kind": "git-ancestor-bootstrap",
                },
                ensure_ascii=True,
                sort_keys=True,
            )
        )
        return 2


if __name__ == "__main__":
    raise SystemExit(_cli())
