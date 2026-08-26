#!/usr/bin/env python3
"""Pin one coherent, syntax-valid RPF bundle before phase zero.

This bootstrap reads only the RPF skill itself.  In a Git-backed development
checkout it snapshots the exact HEAD commit, so concurrent working-tree edits
cannot leak a half-written runtime into an invocation.  A packaged, non-Git
installation must remain byte-stable across two complete reads.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import stat
import subprocess
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Mapping, Sequence


BUNDLE_FORMAT = "rpf-pinned-bundle-v1"
MAX_BUNDLE_FILE_BYTES = 16 * 1024 * 1024
BUNDLE_PATHS = (
    "SKILL.md",
    "agents/openai.yaml",
    "assets/pointer-template.md",
    "references/concurrency.md",
    "references/detection.md",
    "references/orchestration.md",
    "references/persona-lenses.md",
    "references/review-verification.md",
    "references/runtime-contract.md",
    "references/technical-recovery.md",
    "scripts/rpf_bootstrap.py",
    "scripts/rpf_rescue.py",
    "scripts/rpf_runtime.py",
)
RUNTIME_PATH = "scripts/rpf_runtime.py"
BOOTSTRAP_PATH = "scripts/rpf_bootstrap.py"
RESCUE_PATH = "scripts/rpf_rescue.py"


class RpfBootstrapError(RuntimeError):
    """Raised when no coherent, syntax-valid bundle can be pinned."""


@dataclass(frozen=True)
class BundleSource:
    kind: str
    revision: str
    requested_revision: str
    files: Mapping[str, bytes]


def _safe_git_environment() -> dict[str, str]:
    return {
        "PATH": "/usr/bin:/bin",
        "LANG": "C",
        "LC_ALL": "C",
        "GIT_CONFIG_GLOBAL": "/dev/null",
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_OPTIONAL_LOCKS": "0",
    }


def _git(
    arguments: Sequence[str], *, working_directory: Path, check: bool = True
) -> subprocess.CompletedProcess[bytes]:
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
    if check and result.returncode != 0:
        raise RpfBootstrapError("unable to read the committed RPF bundle")
    return result


def _commit_files(
    repository_root: Path, skill_relative: str, revision: str
) -> dict[str, bytes]:
    files: dict[str, bytes] = {}
    for relative in BUNDLE_PATHS:
        object_path = (PurePosixPath(skill_relative) / relative).as_posix()
        result = _git(
            ("show", "--no-ext-diff", f"{revision}:{object_path}"),
            working_directory=repository_root,
        )
        if len(result.stdout) > MAX_BUNDLE_FILE_BYTES:
            raise RpfBootstrapError("committed RPF bundle file exceeds its bound")
        files[relative] = result.stdout
    return files


def _committed_source(skill_directory: Path) -> BundleSource | None:
    discovery = _git(
        ("rev-parse", "--show-toplevel"),
        working_directory=skill_directory,
        check=False,
    )
    if discovery.returncode != 0:
        return None
    try:
        repository_root = Path(discovery.stdout.decode("utf-8", errors="strict").strip())
        repository_root = repository_root.resolve(strict=True)
        skill_relative = skill_directory.relative_to(repository_root).as_posix()
    except (UnicodeDecodeError, OSError, ValueError) as error:
        raise RpfBootstrapError("RPF Git source identity is invalid") from error

    revisions_result = _git(
        ("rev-list", "--first-parent", "--max-count=33", "HEAD"),
        working_directory=repository_root,
    )
    revisions = revisions_result.stdout.decode("ascii", errors="strict").splitlines()
    if not revisions or any(not re.fullmatch(r"[0-9a-f]{40}", item) for item in revisions):
        raise RpfBootstrapError("RPF Git revision is invalid")
    requested_revision = revisions[0]
    for index, revision in enumerate(revisions):
        try:
            files = _commit_files(repository_root, skill_relative, revision)
            _validate_files(files)
        except (RpfBootstrapError, subprocess.SubprocessError):
            continue
        return BundleSource(
            "git-commit" if index == 0 else "git-ancestor-recovery",
            revision,
            requested_revision,
            files,
        )
    raise RpfBootstrapError(
        "no coherent syntax-valid committed RPF bundle exists in the recovery window"
    )


def _read_regular_file(path: Path) -> bytes:
    flags = os.O_RDONLY
    if hasattr(os, "O_CLOEXEC"):
        flags |= os.O_CLOEXEC
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        descriptor = os.open(path, flags)
    except OSError as error:
        raise RpfBootstrapError("RPF bundle path is not safely readable") from error
    try:
        before = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode) or before.st_size > MAX_BUNDLE_FILE_BYTES:
            raise RpfBootstrapError("RPF bundle path is not a bounded regular file")
        chunks: list[bytes] = []
        remaining = MAX_BUNDLE_FILE_BYTES + 1
        while remaining:
            chunk = os.read(descriptor, min(1024 * 1024, remaining))
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        data = b"".join(chunks)
        after = os.fstat(descriptor)
    finally:
        os.close(descriptor)
    if len(data) > MAX_BUNDLE_FILE_BYTES or (
        before.st_dev,
        before.st_ino,
        before.st_size,
        before.st_mtime_ns,
        before.st_ctime_ns,
    ) != (
        after.st_dev,
        after.st_ino,
        after.st_size,
        after.st_mtime_ns,
        after.st_ctime_ns,
    ):
        raise RpfBootstrapError("RPF bundle changed during a read")
    return data


def _direct_files(skill_directory: Path) -> dict[str, bytes]:
    files: dict[str, bytes] = {}
    for relative in BUNDLE_PATHS:
        candidate = skill_directory / relative
        try:
            resolved = candidate.resolve(strict=True)
            resolved.relative_to(skill_directory)
        except (OSError, ValueError) as error:
            raise RpfBootstrapError("RPF bundle path escapes its skill directory") from error
        if resolved != candidate:
            raise RpfBootstrapError("RPF bundle contains a symlink")
        files[relative] = _read_regular_file(candidate)
    return files


def _bundle_digest(files: Mapping[str, bytes]) -> str:
    payload = b"".join(
        relative.encode("utf-8")
        + b"\0"
        + hashlib.sha256(files[relative]).hexdigest().encode("ascii")
        + b"\n"
        for relative in BUNDLE_PATHS
    )
    return hashlib.sha256(payload).hexdigest()


def _validate_files(files: Mapping[str, bytes]) -> str:
    if tuple(files) != BUNDLE_PATHS:
        raise RpfBootstrapError("RPF bundle inventory is incomplete or reordered")
    for relative, label in (
        (BOOTSTRAP_PATH, "bootstrap"),
        (RESCUE_PATH, "rescue"),
        (RUNTIME_PATH, "runtime"),
    ):
        try:
            compile(
                files[relative],
                f"<pinned-rpf>/{relative}",
                "exec",
                dont_inherit=True,
            )
        except (SyntaxError, ValueError) as error:
            line = getattr(error, "lineno", None)
            suffix = f" at line {line}" if isinstance(line, int) else ""
            raise RpfBootstrapError(
                f"RPF {label} does not compile{suffix}"
            ) from error
    return _bundle_digest(files)


def _stable_direct_source(skill_directory: Path, wait_seconds: float) -> BundleSource:
    deadline = time.monotonic() + wait_seconds
    previous: dict[str, bytes] | None = None
    last_error: RpfBootstrapError | None = None
    while True:
        try:
            current = _direct_files(skill_directory)
            _validate_files(current)
            if previous == current:
                digest = _bundle_digest(current)
                return BundleSource("stable-install", digest, digest, current)
            previous = current
            last_error = None
        except RpfBootstrapError as error:
            previous = None
            last_error = error
        if time.monotonic() >= deadline:
            if last_error is not None:
                raise last_error
            raise RpfBootstrapError("RPF installed bundle did not reach a stable revision")
        time.sleep(min(0.1, max(0.0, deadline - time.monotonic())))


def load_source(
    skill_directory: Path, *, prefer_commit: bool = True, wait_seconds: float = 30
) -> BundleSource:
    if (
        isinstance(wait_seconds, bool)
        or not isinstance(wait_seconds, (int, float))
        or not math.isfinite(wait_seconds)
        or wait_seconds < 0
        or wait_seconds > 120
    ):
        raise RpfBootstrapError("bootstrap wait must be between 0 and 120 seconds")
    skill_directory = skill_directory.resolve(strict=True)
    if prefer_commit:
        committed = _committed_source(skill_directory)
        if committed is not None:
            _validate_files(committed.files)
            return committed
    return _stable_direct_source(skill_directory, wait_seconds)


def _write_file(path: Path, data: bytes) -> None:
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        view = memoryview(data)
        while view:
            written = os.write(descriptor, view)
            if written <= 0:
                raise RpfBootstrapError("failed to write the pinned RPF bundle")
            view = view[written:]
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    os.chmod(path, 0o400)


def pin_bundle(
    skill_directory: Path,
    *,
    output_parent: Path | None = None,
    wait_seconds: float = 30,
) -> Mapping[str, object]:
    source = load_source(skill_directory, wait_seconds=wait_seconds)
    bundle_sha256 = _validate_files(source.files)
    if output_parent is not None:
        output_parent = output_parent.resolve(strict=True)
        if not output_parent.is_dir():
            raise RpfBootstrapError("bootstrap output parent is not a directory")
    destination = Path(
        tempfile.mkdtemp(prefix="rpf-pinned-", dir=output_parent)
    ).resolve(strict=True)
    try:
        file_hashes: dict[str, str] = {}
        for relative in BUNDLE_PATHS:
            data = source.files[relative]
            _write_file(destination / relative, data)
            file_hashes[relative] = hashlib.sha256(data).hexdigest()
        manifest = {
            "format": BUNDLE_FORMAT,
            "source_kind": source.kind,
            "source_revision": source.revision,
            "requested_revision": source.requested_revision,
            "bundle_sha256": bundle_sha256,
            "files": file_hashes,
        }
        manifest_bytes = (
            json.dumps(manifest, ensure_ascii=True, sort_keys=True, separators=(",", ":"))
            + "\n"
        ).encode("utf-8")
        _write_file(destination / "bundle-manifest.json", manifest_bytes)
        pinned_files = {
            relative: _read_regular_file(destination / relative)
            for relative in BUNDLE_PATHS
        }
        if pinned_files != source.files or _validate_files(pinned_files) != bundle_sha256:
            raise RpfBootstrapError("pinned RPF bundle readback does not match its source")
        if _read_regular_file(destination / "bundle-manifest.json") != manifest_bytes:
            raise RpfBootstrapError("pinned RPF manifest readback does not match")
        for directory in sorted(
            {path.parent for path in destination.rglob("*") if path.is_file()},
            key=lambda path: len(path.parts),
            reverse=True,
        ):
            os.chmod(directory, 0o500)
        os.chmod(destination, 0o500)
    except Exception:
        # The destination has not been disclosed yet. Leave it private for the
        # host to clean rather than risking a broad or raced recursive removal.
        raise
    return {
        **manifest,
        "skill_dir": os.fspath(destination),
        "runtime_script": os.fspath(destination / RUNTIME_PATH),
        "manifest_path": os.fspath(destination / "bundle-manifest.json"),
    }


def _cli(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Pin or validate a coherent RPF runtime bundle"
    )
    subparsers = parser.add_subparsers(dest="command", required=True)
    pin = subparsers.add_parser("pin", help="pin the committed or stable installed bundle")
    pin.add_argument("--wait-seconds", type=float, default=30)
    verify = subparsers.add_parser(
        "verify-source", help="validate the current skill source without pinning it"
    )
    verify.add_argument("--wait-seconds", type=float, default=0.25)
    arguments = parser.parse_args(argv)
    skill_directory = Path(__file__).resolve().parents[1]
    try:
        if arguments.command == "pin":
            result = pin_bundle(skill_directory, wait_seconds=arguments.wait_seconds)
        else:
            source = load_source(
                skill_directory,
                prefer_commit=False,
                wait_seconds=arguments.wait_seconds,
            )
            result = {
                "format": BUNDLE_FORMAT,
                "source_kind": source.kind,
                "source_revision": source.revision,
                "requested_revision": source.requested_revision,
                "bundle_sha256": _validate_files(source.files),
            }
    except (OSError, RpfBootstrapError, subprocess.SubprocessError) as error:
        print(
            json.dumps(
                {"format": BUNDLE_FORMAT, "status": "unavailable", "reason": str(error)},
                ensure_ascii=True,
                sort_keys=True,
            )
        )
        return 2
    print(json.dumps({**result, "status": "ready"}, ensure_ascii=True, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(_cli())
