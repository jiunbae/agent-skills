from __future__ import annotations

import hashlib
import os
import stat
import subprocess
import tempfile
import unittest
import uuid
from pathlib import Path


SKILL_ROOT = Path(__file__).resolve().parents[1]
SCRIPT = SKILL_ROOT / "scripts" / "model-sync.sh"


class ModelSyncTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name).resolve()
        self.fake_bin = self.root / "bin"
        self.fake_bin.mkdir()
        self.ssh_log = self.root / "ssh.log"
        self.rsync_log = self.root / "rsync.log"
        self.remote_output = self.root / "remote-output"
        self.ssh_count = self.root / "ssh-count"
        self.remote_output.write_text("", encoding="utf-8")

        self._write_executable(
            "ssh",
            """#!/bin/sh
printf '%s\\n' "$@" >> "$FAKE_SSH_LOG"
count=0
if [ -f "$FAKE_SSH_COUNT" ]; then
    count=$(/bin/cat "$FAKE_SSH_COUNT")
fi
printf '%s\\n' "$((count + 1))" > "$FAKE_SSH_COUNT"
if [ "$count" -ge "${FAKE_SSH_FAIL_AFTER:-0}" ] && [ "${FAKE_SSH_STATUS:-0}" -ne 0 ]; then
    exit "$FAKE_SSH_STATUS"
fi
if [ "${FAKE_SSH_EXECUTE:-0}" = 1 ]; then
    shift
    if [ -n "${FAKE_REMOTE_PATH:-}" ]; then
        PATH=$FAKE_REMOTE_PATH
        export PATH
    fi
    exec "$@"
fi
/bin/cat "$FAKE_SSH_OUTPUT"
exit 0
""",
        )
        self._write_executable(
            "rsync",
            """#!/bin/sh
printf '%s\\n' "$@" > "$FAKE_RSYNC_LOG"
exit "${FAKE_RSYNC_STATUS:-0}"
""",
        )
        (self.root / ".model-sync.yaml").write_text(
            """servers:
  gpu1:
    host: gpu1.internal
    user: deploy
    model_base: /srv/models
""",
            encoding="utf-8",
        )

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def _write_executable(self, name: str, content: str) -> None:
        path = self.fake_bin / name
        path.write_text(content, encoding="utf-8")
        path.chmod(path.stat().st_mode | stat.S_IXUSR)

    def _run(self, *args: str, **env_overrides: str) -> subprocess.CompletedProcess[str]:
        env = os.environ.copy()
        env.update(
            {
                "HOME": str(self.root),
                "PATH": f"{self.fake_bin}:/usr/bin:/bin",
                "FAKE_SSH_LOG": str(self.ssh_log),
                "FAKE_SSH_COUNT": str(self.ssh_count),
                "FAKE_RSYNC_LOG": str(self.rsync_log),
                "FAKE_SSH_OUTPUT": str(self.remote_output),
            }
        )
        env.update(env_overrides)
        return subprocess.run(
            ["/bin/bash", str(SCRIPT), *args],
            cwd=SKILL_ROOT,
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )

    def _model(self, content: bytes = b"weights") -> Path:
        model = self.root / "model-v1"
        model.mkdir()
        (model / "weights.bin").write_bytes(content)
        return model

    def _set_remote_manifest(self, content: bytes = b"weights") -> None:
        digest = hashlib.sha256(content).hexdigest()
        self.remote_output.write_text(f"{digest}\tweights.bin\n", encoding="utf-8")

    def _set_model_base(self, model_base: Path) -> None:
        (self.root / ".model-sync.yaml").write_text(
            f"""servers:
  gpu1:
    host: gpu1.internal
    user: deploy
    model_base: {model_base}
""",
            encoding="utf-8",
        )

    def test_delete_is_disabled_before_any_transfer(self) -> None:
        model = self._model()

        result = self._run("push", str(model), "gpu1", "--delete")

        self.assertEqual(result.returncode, 2)
        self.assertIn("--delete is disabled", result.stderr)
        self.assertFalse(self.rsync_log.exists())
        self.assertFalse(self.ssh_log.exists())

    def test_exec_is_disabled_before_ssh(self) -> None:
        result = self._run("exec", "gpu1", "touch /tmp/should-not-run")

        self.assertEqual(result.returncode, 2)
        self.assertIn("exec is disabled", result.stderr)
        self.assertFalse(self.ssh_log.exists())

    def test_unsafe_config_path_is_rejected_before_external_commands(self) -> None:
        (self.root / ".model-sync.yaml").write_text(
            """servers:
  gpu1:
    host: gpu1.internal
    user: deploy
    model_base: "/srv/models; printf injected"
""",
            encoding="utf-8",
        )
        model = self._model()

        result = self._run("push", str(model), "gpu1")

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unsafe model_base", result.stderr)
        self.assertFalse(self.rsync_log.exists())
        self.assertFalse(self.ssh_log.exists())

    def test_remote_target_is_confined_and_cannot_inject_shell_text(self) -> None:
        model = self._model()

        result = self._run(
            "push",
            str(model),
            "gpu1:/srv/models;printf-injected",
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("within '/srv/models'", result.stderr)
        self.assertFalse(self.rsync_log.exists())
        self.assertFalse(self.ssh_log.exists())

    def test_push_preserves_local_path_as_one_rsync_argument(self) -> None:
        model_parent = self.root / "local path"
        model = model_parent / "model-v1"
        model.mkdir(parents=True)
        (model / "weights.bin").write_bytes(b"weights")

        result = self._run("push", str(model), "gpu1", "--dry-run")

        self.assertEqual(result.returncode, 0, result.stderr)
        args = self.rsync_log.read_text(encoding="utf-8").splitlines()
        self.assertIn(f"{model}/", args)
        self.assertIn("deploy@gpu1.internal:/srv/models/model-v1/", args)
        self.assertTrue(self.ssh_log.exists())

    def test_push_relative_colon_source_is_canonicalized_before_rsync(self) -> None:
        model = self.root / "source:with-colon"
        model.mkdir()
        (model / "weights.bin").write_bytes(b"weights")
        relative_model = os.path.relpath(model, SKILL_ROOT)

        result = self._run(
            "push",
            relative_model,
            "gpu1:fixed-destination",
            "--dry-run",
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        args = self.rsync_log.read_text(encoding="utf-8").splitlines()
        self.assertEqual(args[-2], f"{model}/")
        self.assertTrue(args[-2].startswith("/"))

    def test_push_relative_target_is_resolved_below_model_base(self) -> None:
        model = self._model()

        result = self._run(
            "push",
            str(model),
            "gpu1:releases/model-v1",
            "--dry-run",
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        args = self.rsync_log.read_text(encoding="utf-8").splitlines()
        self.assertIn(
            "deploy@gpu1.internal:/srv/models/releases/model-v1/",
            args,
        )

    def test_local_model_root_symlink_is_rejected(self) -> None:
        model = self._model()
        linked_model = self.root / "linked-model"
        linked_model.symlink_to(model, target_is_directory=True)

        result = self._run("push", str(linked_model), "gpu1", "--dry-run")

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("root cannot be a symlink", result.stderr)
        self.assertFalse(self.rsync_log.exists())
        self.assertFalse(self.ssh_log.exists())

    def test_push_verification_passes_only_for_matching_manifest(self) -> None:
        model = self._model()
        self._set_remote_manifest()

        result = self._run("push", str(model), "gpu1", "--verify")

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Verification passed", result.stdout)
        self.assertIn("| Verified | yes |", result.stdout)
        self.assertIn("Sync complete", result.stdout)

    def test_push_verification_mismatch_is_failure_dominant(self) -> None:
        model = self._model()
        self._set_remote_manifest(b"different")

        result = self._run("push", str(model), "gpu1", "--verify")

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Verification failed", result.stderr)
        self.assertNotIn("| Verified | yes |", result.stdout)
        self.assertNotIn("Sync complete", result.stdout)

    def test_local_manifest_traversal_failure_cannot_verify(self) -> None:
        model = self._model()
        self._set_remote_manifest()
        find_count = self.root / "find-count"
        self._write_executable(
            "find",
            """#!/bin/sh
count=0
if [ -f "$FAKE_FIND_COUNT" ]; then
    count=$(/bin/cat "$FAKE_FIND_COUNT")
fi
count=$((count + 1))
printf '%s\\n' "$count" > "$FAKE_FIND_COUNT"
if [ "$count" -eq "${FAKE_FIND_FAIL_ON:-0}" ]; then
    printf './weights.bin\\n'
    exit 74
fi
exec /usr/bin/find "$@"
""",
        )

        result = self._run(
            "push",
            str(model),
            "gpu1",
            "--verify",
            FAKE_FIND_COUNT=str(find_count),
            FAKE_FIND_FAIL_ON="2",
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Local model traversal failed", result.stderr)
        self.assertIn("Could not build the local verification manifest", result.stderr)
        self.assertNotIn("Verification passed", result.stdout)
        self.assertNotIn("| Verified | yes |", result.stdout)

    def test_remote_manifest_error_cannot_be_reported_as_verified(self) -> None:
        model = self._model()
        self._set_remote_manifest()

        result = self._run(
            "push",
            str(model),
            "gpu1",
            "--verify",
            FAKE_SSH_STATUS="74",
            FAKE_SSH_FAIL_AFTER="1",
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Could not build the remote verification manifest", result.stderr)
        self.assertNotIn("| Verified | yes |", result.stdout)
        self.assertNotIn("Sync complete", result.stdout)

    def test_remote_manifest_rejects_an_extra_symlink(self) -> None:
        model = self._model()
        remote_base = self.root / "remote"
        remote_model = remote_base / "model-v1"
        remote_model.mkdir(parents=True)
        (remote_model / "weights.bin").write_bytes(b"weights")
        (remote_model / "extra-link").symlink_to("weights.bin")
        self._set_model_base(remote_base)

        result = self._run(
            "push",
            str(model),
            "gpu1",
            "--verify",
            FAKE_SSH_EXECUTE="1",
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("remote model tree contains a symlink", result.stderr)
        self.assertIn("Could not build the remote verification manifest", result.stderr)
        self.assertNotIn("| Verified | yes |", result.stdout)

    def test_remote_manifest_rejects_an_unreadable_tree(self) -> None:
        model = self._model()
        local_blocked = model / "blocked"
        local_blocked.mkdir()
        (local_blocked / "part.bin").write_bytes(b"part")

        remote_base = self.root / "remote"
        remote_model = remote_base / "model-v1"
        remote_blocked = remote_model / "blocked"
        remote_blocked.mkdir(parents=True)
        (remote_model / "weights.bin").write_bytes(b"weights")
        (remote_blocked / "part.bin").write_bytes(b"part")
        self._set_model_base(remote_base)
        remote_blocked.chmod(0)

        try:
            result = self._run(
                "push",
                str(model),
                "gpu1",
                "--verify",
                FAKE_SSH_EXECUTE="1",
            )
        finally:
            remote_blocked.chmod(stat.S_IRWXU)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Could not build the remote verification manifest", result.stderr)
        self.assertNotIn("| Verified | yes |", result.stdout)

    def test_remote_hash_failure_is_failure_dominant(self) -> None:
        model = self._model()
        remote_base = self.root / "remote"
        remote_model = remote_base / "model-v1"
        remote_model.mkdir(parents=True)
        (remote_model / "weights.bin").write_bytes(b"weights")
        self._set_model_base(remote_base)

        remote_bin = self.root / "remote-bin"
        remote_bin.mkdir()
        for command in ("sha256sum", "shasum"):
            path = remote_bin / command
            path.write_text("#!/bin/sh\nexit 74\n", encoding="utf-8")
            path.chmod(path.stat().st_mode | stat.S_IXUSR)

        result = self._run(
            "push",
            str(model),
            "gpu1",
            "--verify",
            FAKE_SSH_EXECUTE="1",
            FAKE_REMOTE_PATH=f"{remote_bin}:/usr/bin:/bin",
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("remote model hash failed", result.stderr)
        self.assertIn("Could not build the remote verification manifest", result.stderr)
        self.assertNotIn("| Verified | yes |", result.stdout)

    def test_second_remote_mktemp_failure_cleans_the_first_file(self) -> None:
        model = self._model()
        remote_base = self.root / "remote"
        remote_model = remote_base / "model-v1"
        remote_model.mkdir(parents=True)
        (remote_model / "weights.bin").write_bytes(b"weights")
        self._set_model_base(remote_base)

        remote_bin = self.root / "remote-bin"
        remote_bin.mkdir()
        first_temp = self.root / "first-manifest"
        mktemp_count = self.root / "mktemp-count"
        mktemp = remote_bin / "mktemp"
        mktemp.write_text(
            """#!/bin/sh
if [ ! -e "$FAKE_MKTEMP_COUNT" ]; then
    : > "$FAKE_MKTEMP_COUNT"
    : > "$FAKE_FIRST_TEMP"
    printf '%s\\n' "$FAKE_FIRST_TEMP"
    exit 0
fi
exit 73
""",
            encoding="utf-8",
        )
        mktemp.chmod(mktemp.stat().st_mode | stat.S_IXUSR)

        result = self._run(
            "push",
            str(model),
            "gpu1",
            "--verify",
            FAKE_SSH_EXECUTE="1",
            FAKE_REMOTE_PATH=f"{remote_bin}:/usr/bin:/bin",
            FAKE_MKTEMP_COUNT=str(mktemp_count),
            FAKE_FIRST_TEMP=str(first_temp),
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(first_temp.exists())
        self.assertIn("Could not build the remote verification manifest", result.stderr)
        self.assertNotIn("| Verified | yes |", result.stdout)

    def test_rsync_failure_cannot_be_reported_as_complete(self) -> None:
        model = self._model()

        result = self._run("push", str(model), "gpu1", FAKE_RSYNC_STATUS="23")

        self.assertEqual(result.returncode, 23)
        self.assertTrue(self.ssh_log.exists())
        self.assertNotIn("Sync complete", result.stdout)

    def test_push_remote_symlink_component_fails_before_rsync(self) -> None:
        model = self._model()
        remote_base = self.root / "remote"
        outside = self.root / "outside"
        remote_base.mkdir()
        outside.mkdir()
        (remote_base / "releases").symlink_to(outside, target_is_directory=True)
        self._set_model_base(remote_base)

        result = self._run(
            "push",
            str(model),
            "gpu1:releases/model-v1",
            FAKE_SSH_EXECUTE="1",
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("remote push destination contains a symlink component", result.stderr)
        self.assertIn("structural preflight", result.stderr)
        self.assertFalse(self.rsync_log.exists())

    def test_pull_symlink_component_fails_before_transfer(self) -> None:
        destination_parent = self.root / "destination"
        outside = self.root / "outside"
        destination_parent.mkdir()
        outside.mkdir()
        (destination_parent / "linked").symlink_to(outside, target_is_directory=True)

        result = self._run(
            "pull",
            "gpu1:model-v1",
            str(destination_parent / "linked" / "model-v1"),
            "--dry-run",
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("symlink component", result.stderr)
        self.assertFalse(self.ssh_log.exists())
        self.assertFalse(self.rsync_log.exists())

    def test_pull_relative_colon_destination_is_canonicalized_for_rsync(self) -> None:
        target = self.root / "pull:destination"
        relative_target = os.path.relpath(target, SKILL_ROOT)

        result = self._run(
            "pull",
            "gpu1:model-v1",
            relative_target,
            "--dry-run",
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        args = self.rsync_log.read_text(encoding="utf-8").splitlines()
        self.assertEqual(args[-1], f"{target}/")
        self.assertTrue(args[-1].startswith("/"))
        self.assertFalse(target.exists())

    def test_pull_dry_run_accepts_root_as_nearest_containment_base(self) -> None:
        target = Path(f"/model-sync-dry-run-{uuid.uuid4().hex}")

        result = self._run(
            "pull",
            "gpu1:model-v1",
            str(target),
            "--dry-run",
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        args = self.rsync_log.read_text(encoding="utf-8").splitlines()
        self.assertEqual(args[-1], f"{target}/")
        self.assertFalse(target.exists())

    def test_pull_verification_uses_the_same_manifest_check(self) -> None:
        target = self._model()
        self._set_remote_manifest()

        result = self._run("pull", "gpu1:model-v1", str(target), "--verify")

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Verification passed", result.stdout)
        self.assertIn("| Verified | yes |", result.stdout)

    def test_diff_reports_portable_byte_sizes_without_gnu_stat(self) -> None:
        model = self._model(b"abc")
        self.remote_output.write_text("3\n", encoding="utf-8")

        result = self._run("diff", str(model), "gpu1")

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("| weights.bin | 3 B | 3 B | same |", result.stdout)

    def test_checksum_documentation_has_a_real_line_continuation(self) -> None:
        skill = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")

        self.assertIn("rsync -avzc \\\n  ./models/ user@server:/models/", skill)
        self.assertNotIn("\\  # -c for checksum", skill)


if __name__ == "__main__":
    unittest.main()
