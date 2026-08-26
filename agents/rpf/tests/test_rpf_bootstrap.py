import hashlib
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "rpf_bootstrap", ROOT / "scripts" / "rpf_bootstrap.py"
)
assert SPEC is not None and SPEC.loader is not None
bootstrap = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = bootstrap
SPEC.loader.exec_module(bootstrap)


class RpfBootstrapTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.base = Path(self.temporary.name)

    def tearDown(self) -> None:
        for root, directories, _ in os.walk(self.base, topdown=False):
            for directory in directories:
                os.chmod(Path(root) / directory, 0o700)
            os.chmod(root, 0o700)
        self.temporary.cleanup()

    def make_skill(self, name: str = "rpf") -> Path:
        skill = self.base / name
        for relative in bootstrap.BUNDLE_PATHS:
            path = skill / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            data = b"VALUE = 1\n" if relative == bootstrap.RUNTIME_PATH else b"fixture\n"
            path.write_bytes(data)
        return skill

    def git(self, repository: Path, *arguments: str) -> str:
        result = subprocess.run(
            ["git", "-c", "commit.gpgsign=false", *arguments],
            cwd=repository,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=True,
            text=True,
        )
        return result.stdout.strip()

    def commit_skill(self, skill: Path) -> str:
        repository = skill.parent
        self.git(repository, "init", "-q")
        self.git(repository, "config", "user.name", "RPF Test")
        self.git(repository, "config", "user.email", "rpf-test@example.invalid")
        self.git(repository, "add", skill.name)
        self.git(repository, "commit", "-qm", "fixture")
        return self.git(repository, "rev-parse", "HEAD")

    def test_pin_uses_one_committed_revision_not_broken_worktree_bytes(self) -> None:
        skill = self.make_skill()
        revision = self.commit_skill(skill)
        (skill / bootstrap.RUNTIME_PATH).write_text(
            "if True:\n    pass\nfinally:\n    pass\n", encoding="utf-8"
        )
        (skill / "references/runtime-contract.md").write_text(
            "unreleased edit\n", encoding="utf-8"
        )

        result = bootstrap.pin_bundle(skill, output_parent=self.base, wait_seconds=0)

        self.assertEqual("git-commit", result["source_kind"])
        self.assertEqual(revision, result["source_revision"])
        self.assertEqual(revision, result["requested_revision"])
        pinned = Path(str(result["skill_dir"]))
        self.assertEqual(b"VALUE = 1\n", (pinned / bootstrap.RUNTIME_PATH).read_bytes())
        self.assertEqual(
            b"fixture\n", (pinned / "references/runtime-contract.md").read_bytes()
        )
        compile(
            (pinned / bootstrap.RUNTIME_PATH).read_bytes(),
            "pinned-runtime",
            "exec",
            dont_inherit=True,
        )

    def test_pin_writes_a_closed_hash_manifest_and_read_only_snapshot(self) -> None:
        skill = self.make_skill("installed-rpf")

        result = bootstrap.pin_bundle(skill, output_parent=self.base, wait_seconds=0.2)

        destination = Path(str(result["skill_dir"]))
        manifest = json.loads((destination / "bundle-manifest.json").read_text())
        self.assertEqual(bootstrap.BUNDLE_FORMAT, manifest["format"])
        self.assertEqual(tuple(manifest["files"]), tuple(sorted(bootstrap.BUNDLE_PATHS)))
        for relative, digest in manifest["files"].items():
            path = destination / relative
            self.assertEqual(digest, hashlib.sha256(path.read_bytes()).hexdigest())
            self.assertEqual(0, path.stat().st_mode & 0o222)
        self.assertEqual(0, destination.stat().st_mode & 0o222)

    def test_current_source_validation_rejects_the_reported_finally_shape(self) -> None:
        skill = self.make_skill("invalid-rpf")
        (skill / bootstrap.RUNTIME_PATH).write_text(
            "def broken():\n    if True:\n        pass\n    finally:\n        pass\n",
            encoding="utf-8",
        )

        with self.assertRaisesRegex(
            bootstrap.RpfBootstrapError, r"does not compile at line 4"
        ):
            bootstrap.load_source(skill, prefer_commit=False, wait_seconds=0.15)

    def test_committed_syntax_error_uses_a_disclosed_verified_ancestor(self) -> None:
        skill = self.make_skill("recoverable-rpf")
        valid_revision = self.commit_skill(skill)
        (skill / bootstrap.RUNTIME_PATH).write_text(
            "if True:\n    pass\nfinally:\n    pass\n", encoding="utf-8"
        )
        self.git(skill.parent, "add", skill.name)
        self.git(skill.parent, "commit", "-qm", "broken fixture")
        requested_revision = self.git(skill.parent, "rev-parse", "HEAD")

        source = bootstrap.load_source(skill, prefer_commit=True, wait_seconds=0)

        self.assertEqual("git-ancestor-recovery", source.kind)
        self.assertEqual(valid_revision, source.revision)
        self.assertEqual(requested_revision, source.requested_revision)
        self.assertEqual(b"VALUE = 1\n", source.files[bootstrap.RUNTIME_PATH])

    def test_initial_corrupt_commit_has_no_unverified_fallback(self) -> None:
        skill = self.make_skill("corrupt-rpf")
        (skill / bootstrap.RUNTIME_PATH).write_text(
            "if True:\n    pass\nfinally:\n    pass\n", encoding="utf-8"
        )
        self.commit_skill(skill)

        with self.assertRaisesRegex(
            bootstrap.RpfBootstrapError, "no coherent syntax-valid committed"
        ):
            bootstrap.load_source(skill, prefer_commit=True, wait_seconds=0)

    def test_loaded_bootstrap_can_recover_a_corrupt_committed_successor(self) -> None:
        skill = self.make_skill("bootstrap-recovery-rpf")
        valid_revision = self.commit_skill(skill)
        (skill / bootstrap.BOOTSTRAP_PATH).write_text(
            "if True:\n    pass\nfinally:\n    pass\n", encoding="utf-8"
        )
        self.git(skill.parent, "add", skill.name)
        self.git(skill.parent, "commit", "-qm", "broken bootstrap fixture")

        source = bootstrap.load_source(skill, prefer_commit=True, wait_seconds=0)

        self.assertEqual("git-ancestor-recovery", source.kind)
        self.assertEqual(valid_revision, source.revision)

    def test_rescue_entrypoint_runs_when_the_loaded_bootstrap_cannot_parse(self) -> None:
        skill = self.make_skill("rescuable-entrypoint-rpf")
        (skill / bootstrap.BOOTSTRAP_PATH).write_bytes(
            (ROOT / bootstrap.BOOTSTRAP_PATH).read_bytes()
        )
        (skill / bootstrap.RESCUE_PATH).write_bytes(
            (ROOT / bootstrap.RESCUE_PATH).read_bytes()
        )
        valid_revision = self.commit_skill(skill)
        (skill / bootstrap.BOOTSTRAP_PATH).write_text(
            "if True:\n    pass\nfinally:\n    pass\n", encoding="utf-8"
        )
        self.git(skill.parent, "add", skill.name)
        self.git(skill.parent, "commit", "-qm", "broken bootstrap entrypoint")
        requested_revision = self.git(skill.parent, "rev-parse", "HEAD")

        completed = subprocess.run(
            [
                sys.executable,
                os.fspath(skill / bootstrap.RESCUE_PATH),
                "pin",
                "--wait-seconds",
                "0",
            ],
            cwd=skill.parent,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
            text=True,
            timeout=20,
        )
        result = json.loads(completed.stdout)
        pinned = Path(result["skill_dir"])
        try:
            self.assertEqual(0, completed.returncode, completed.stderr)
            self.assertEqual("ready", result["status"])
            self.assertEqual("git-ancestor-bootstrap", result["rescue_source_kind"])
            self.assertEqual(valid_revision, result["rescue_source_revision"])
            self.assertEqual(requested_revision, result["requested_revision"])
            self.assertEqual(valid_revision, result["source_revision"])
        finally:
            for root, directories, files in os.walk(pinned):
                for name in files:
                    os.chmod(Path(root) / name, 0o600)
                for name in directories:
                    os.chmod(Path(root) / name, 0o700)
                os.chmod(root, 0o700)
            shutil.rmtree(pinned)

    def test_rescue_entrypoint_reports_bad_usage_without_a_traceback(self) -> None:
        completed = subprocess.run(
            [sys.executable, os.fspath(ROOT / bootstrap.RESCUE_PATH), "verify-source"],
            cwd=ROOT,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
            text=True,
            timeout=20,
        )

        self.assertEqual(2, completed.returncode)
        self.assertEqual("", completed.stderr)
        self.assertEqual("unavailable", json.loads(completed.stdout)["status"])

    def test_nonfinite_wait_cannot_create_an_unbounded_bootstrap_loop(self) -> None:
        skill = self.make_skill("bounded-rpf")
        for invalid in (float("nan"), float("inf"), -1, 121, True):
            with self.subTest(invalid=invalid):
                with self.assertRaisesRegex(
                    bootstrap.RpfBootstrapError, "between 0 and 120 seconds"
                ):
                    bootstrap.load_source(skill, prefer_commit=False, wait_seconds=invalid)

    def test_contract_requires_pinning_before_phase_zero(self) -> None:
        skill_text = (ROOT / "SKILL.md").read_text(encoding="utf-8")
        contract_text = (ROOT / "references/runtime-contract.md").read_text(
            encoding="utf-8"
        )
        normalized_contract = " ".join(contract_text.split())
        for required in (
            "rpf_bootstrap.py pin",
            "PINNED_SKILL_DIR",
            "RPF_BUNDLE_SHA256",
            "skill-refresh-in-progress",
            "rpf_rescue.py pin",
        ):
            self.assertIn(required, skill_text)
        for required in (
            "## Immutable runtime bundle",
            "one exact `HEAD` commit object",
            "not a review barrier failure",
            "nearest complete syntax-valid first-parent ancestor",
            "without reading target bytes or marking the RPF/host goal blocked",
            "rescue_source_revision",
        ):
            self.assertIn(required, normalized_contract)


if __name__ == "__main__":
    unittest.main()
