import contextlib
import importlib.util
import io
import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock


SCRIPT = Path(__file__).parents[1] / "scripts" / "notion-upload.py"
SPEC = importlib.util.spec_from_file_location("notion_upload", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class FakePages:
    def __init__(self, fail_create=False, fail_on_create=None):
        self.created = []
        self.archived = []
        self.fail_create = fail_create
        self.fail_on_create = fail_on_create

    def create(self, **kwargs):
        self.created.append(kwargs)
        if self.fail_create or len(self.created) == self.fail_on_create:
            raise RuntimeError("secret_remote_response")
        return {"id": f"page-{len(self.created)}", "url": "https://notion.invalid/private"}

    def update(self, **kwargs):
        self.archived.append(kwargs)
        return {"id": kwargs["page_id"], "archived": True}


class FakeChildren:
    def __init__(self):
        self.appended = []

    def append(self, **kwargs):
        self.appended.append(kwargs)


class FakeClient:
    def __init__(self, fail_create=False, fail_on_create=None):
        self.pages = FakePages(fail_create=fail_create, fail_on_create=fail_on_create)
        self.blocks = type("Blocks", (), {"children": FakeChildren()})()


class NotionUploadTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.manifest = Path(self.tempdir.name) / "manifest.json"
        self.client = FakeClient()
        self.env = mock.patch.dict(
            os.environ,
            {
                "NOTION_TOKEN": "test-token-not-a-real-secret",
                "NOTION_PAGE_ID": "target-id-not-printed",
                "AGENTS_DIR": self.tempdir.name,
            },
            clear=False,
        )
        self.env.start()

    def tearDown(self):
        self.env.stop()
        self.tempdir.cleanup()

    def factory(self, auth):
        self.assertEqual(auth, "test-token-not-a-real-secret")
        return self.client

    def capture(self, function, *args, **kwargs):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            result = function(*args, **kwargs)
        return result, output.getvalue()

    def upload(self, content="safe report", **kwargs):
        defaults = {
            "title": "safe title",
            "classification": "internal",
            "retention_days": 30,
            "manifest_path": self.manifest,
            "client_factory": self.factory,
        }
        defaults.update(kwargs)
        return MODULE.upload_document(content, **defaults)

    def test_help_does_not_require_notion_client(self):
        completed = subprocess.run(
            [sys.executable, "-S", str(SCRIPT), "--help"],
            check=False,
            capture_output=True,
            text=True,
            env={"PATH": os.environ.get("PATH", "")},
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertIn("--classification", completed.stdout)

    def test_body_bearing_argv_is_rejected_before_upload(self):
        legacy_argvs = (
            ("--content", "private-body"),
            ("--content=private-body",),
            ("--summary", "private-body"),
            ("--changes", "private-body"),
            ("-s", "private-body"),
            ("-c", "private-body"),
            ("-s=private-body",),
            ("-c=private-body",),
            ("-sprivate-body",),
            ("-cprivate-body",),
        )
        for legacy_argv in legacy_argvs:
            with self.subTest(argv=legacy_argv):
                stdout = io.StringIO()
                stderr = io.StringIO()
                with (
                    mock.patch.object(sys, "argv", [str(SCRIPT), *legacy_argv]),
                    mock.patch.object(MODULE, "upload_document") as upload,
                    contextlib.redirect_stdout(stdout),
                    contextlib.redirect_stderr(stderr),
                    self.assertRaises(SystemExit) as raised,
                ):
                    MODULE.main()

                self.assertEqual(raised.exception.code, 2)
                upload.assert_not_called()
                self.assertNotIn("private-body", stdout.getvalue() + stderr.getvalue())

    def test_redacts_credentials_and_pii_without_returning_matches(self):
        original = (
            "email owner@example.com\n"
            "token=abcdef1234567890\n"
            "phone 010-1234-5678\n"
            "card 4111 1111 1111 1111"
        )
        masked, findings = MODULE.redact_sensitive_content(original)
        self.assertNotIn("owner@example.com", masked)
        self.assertNotIn("abcdef1234567890", masked)
        self.assertNotIn("010-1234-5678", masked)
        self.assertNotIn("4111", masked)
        self.assertGreaterEqual(sum(findings.values()), 4)
        self.assertNotIn("owner@example.com", repr(findings))

    def test_dry_run_never_prints_body_title_or_target(self):
        body = "owner@example.com highly private sentence"
        result, output = self.capture(
            self.upload,
            body,
            title="Private Customer Name",
            dry_run=True,
        )
        self.assertTrue(result)
        self.assertNotIn(body, output)
        self.assertNotIn("owner@example.com", output)
        self.assertNotIn("Private Customer Name", output)
        self.assertNotIn("target-id-not-printed", output)
        self.assertIn("본문·제목·대상은 표시하지 않음", output)
        self.assertFalse(self.manifest.exists())

    def test_missing_classification_and_retention_metadata_fail_closed(self):
        result, _ = self.capture(self.upload, classification=None)
        self.assertFalse(result)
        result, _ = self.capture(self.upload, retention_days=None)
        self.assertFalse(result)
        self.assertEqual(self.client.pages.created, [])

    def test_completed_retry_is_noop_and_manifest_is_private(self):
        result, first_output = self.capture(self.upload)
        self.assertTrue(result)
        self.assertEqual(len(self.client.pages.created), 1)
        result, second_output = self.capture(self.upload)
        self.assertTrue(result)
        self.assertEqual(len(self.client.pages.created), 1)
        self.assertIn("이미 완료된 업로드", second_output)
        self.assertRegex(first_output, r"nup-[0-9a-f]{64}")
        self.assertEqual(stat.S_IMODE(self.manifest.stat().st_mode), 0o600)
        manifest_text = self.manifest.read_text()
        self.assertNotIn("safe report", manifest_text)
        self.assertNotIn("safe title", manifest_text)
        self.assertNotIn("target-id-not-printed", manifest_text)

    def test_same_supplied_key_with_different_payload_is_refused(self):
        result, _ = self.capture(
            self.upload,
            "first",
            idempotency_key="stable-run-001",
        )
        self.assertTrue(result)
        result, output = self.capture(
            self.upload,
            "second",
            idempotency_key="stable-run-001",
        )
        self.assertFalse(result)
        self.assertIn("다른 payload", output)
        self.assertEqual(len(self.client.pages.created), 1)

    def test_indeterminate_create_is_not_retried_or_logged_verbatim(self):
        self.client = FakeClient(fail_create=True)
        result, first_output = self.capture(self.upload, "sensitive body")
        self.assertFalse(result)
        self.assertNotIn("secret_remote_response", first_output)
        self.assertNotIn("--rollback", first_output)
        self.assertIn("워크스페이스 소유자", first_output)
        self.assertIn("새 opaque --idempotency-key", first_output)
        self.client.pages.fail_create = False
        result, second_output = self.capture(self.upload, "sensitive body")
        self.assertFalse(result)
        self.assertNotIn("--rollback", second_output)
        self.assertIn("새 opaque --idempotency-key", second_output)
        self.assertEqual(len(self.client.pages.created), 1)
        result, _ = self.capture(
            self.upload,
            "sensitive body",
            idempotency_key="fresh-recovery-001",
        )
        self.assertTrue(result)
        self.assertEqual(len(self.client.pages.created), 2)

    def test_rollback_archives_known_page_and_erase_scrubs_record(self):
        _, output = self.capture(self.upload)
        key = next(word for word in output.split() if word.startswith("nup-"))
        result, _ = self.capture(
            MODULE.rollback_upload,
            key,
            manifest_path=self.manifest,
            client_factory=self.factory,
        )
        self.assertTrue(result)
        self.assertEqual(self.client.pages.archived[-1], {"page_id": "page-1", "archived": True})
        archived_count = len(self.client.pages.archived)
        with mock.patch.dict(os.environ, {}, clear=True):
            result, _ = self.capture(
                MODULE.rollback_upload,
                key,
                erase=True,
                manifest_path=self.manifest,
                client_factory=lambda auth: self.fail("remote client must not be called"),
            )
        self.assertTrue(result)
        self.assertEqual(len(self.client.pages.archived), archived_count)
        record = json.loads(self.manifest.read_text())["records"][key]
        self.assertEqual(record["status"], "erased")
        self.assertNotIn("page_ids", record)
        self.assertNotIn("payload_hash", record)

    def test_multipart_rollback_archives_every_known_page(self):
        content = "\n".join(f"line {index}" for index in range(120))
        result, output = self.capture(self.upload, content)
        self.assertTrue(result)
        self.assertEqual(len(self.client.pages.created), 2)
        key = next(word for word in output.split() if word.startswith("nup-"))
        result, _ = self.capture(
            MODULE.rollback_upload,
            key,
            manifest_path=self.manifest,
            client_factory=self.factory,
        )
        self.assertTrue(result)
        self.assertEqual(
            self.client.pages.archived,
            [
                {"page_id": "page-1", "archived": True},
                {"page_id": "page-2", "archived": True},
            ],
        )

    def test_partial_multipart_rollback_archives_known_part_and_requires_reconciliation(self):
        self.client = FakeClient(fail_on_create=2)
        content = "\n".join(f"line {index}" for index in range(120))
        result, upload_output = self.capture(self.upload, content)
        self.assertFalse(result)
        self.assertNotIn("--rollback", upload_output)
        self.assertIn("대조·정리", upload_output)
        key = next(iter(json.loads(self.manifest.read_text())["records"]))
        self.client.pages.fail_on_create = None
        result, rollback_output = self.capture(
            MODULE.rollback_upload,
            key,
            manifest_path=self.manifest,
            client_factory=self.factory,
        )
        self.assertFalse(result)
        self.assertEqual(
            self.client.pages.archived,
            [{"page_id": "page-1", "archived": True}],
        )
        self.assertIn("대조·정리", rollback_output)
        self.assertIn("새 opaque --idempotency-key", rollback_output)

    def test_retention_archives_expired_record_and_scrubs_ids(self):
        result, _ = self.capture(self.upload, retention_days=1)
        self.assertTrue(result)
        future = datetime(2100, 1, 1, tzinfo=timezone.utc)
        result, _ = self.capture(
            MODULE.enforce_retention,
            manifest_path=self.manifest,
            client_factory=self.factory,
            now=future,
        )
        self.assertTrue(result)
        records = json.loads(self.manifest.read_text())["records"]
        record = next(iter(records.values()))
        self.assertEqual(record["status"], "expired")
        self.assertNotIn("page_ids", record)

    def test_retention_after_rollback_only_scrubs_local_record(self):
        result, output = self.capture(self.upload, retention_days=1)
        self.assertTrue(result)
        key = next(word for word in output.split() if word.startswith("nup-"))
        result, _ = self.capture(
            MODULE.rollback_upload,
            key,
            manifest_path=self.manifest,
            client_factory=self.factory,
        )
        self.assertTrue(result)
        archived_count = len(self.client.pages.archived)

        future = datetime(2100, 1, 1, tzinfo=timezone.utc)
        with mock.patch.dict(os.environ, {}, clear=True):
            result, _ = self.capture(
                MODULE.enforce_retention,
                manifest_path=self.manifest,
                client_factory=lambda auth: self.fail("remote client must not be called"),
                now=future,
            )
        self.assertTrue(result)
        self.assertEqual(len(self.client.pages.archived), archived_count)
        record = json.loads(self.manifest.read_text())["records"][key]
        self.assertEqual(record["status"], "expired")
        self.assertNotIn("page_ids", record)
        self.assertNotIn("payload_hash", record)


if __name__ == "__main__":
    unittest.main()
