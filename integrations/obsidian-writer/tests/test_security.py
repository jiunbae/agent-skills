import importlib.util
import os
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock


INTEGRATION_ROOT = Path(__file__).resolve().parents[1]
WRITER_PATH = INTEGRATION_ROOT / "scripts" / "obsidian-write.py"
PUBLISH_PATH = INTEGRATION_ROOT / "scripts" / "docs-publish.sh"

SPEC = importlib.util.spec_from_file_location("obsidian_writer", WRITER_PATH)
WRITER = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(WRITER)


class WriterPathSecurityTests(unittest.TestCase):
    def test_config_parser_accepts_canonical_and_legacy_vault_keys(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            base = Path(temp_dir)
            canonical = base / "canonical.md"
            legacy = base / "legacy.md"
            canonical.write_text("- **Vault 경로**: /canonical/vault\n", encoding="utf-8")
            legacy.write_text("- **경로**: /legacy/vault\n", encoding="utf-8")

            self.assertEqual(WRITER.parse_config(canonical)["vault_path"], "/canonical/vault")
            self.assertEqual(WRITER.parse_config(legacy)["vault_path"], "/legacy/vault")

    def test_setup_writes_canonical_vault_key(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            base = Path(temp_dir)
            config_path = base / "OBSIDIAN.md"
            vault = base / "vault"
            vault.mkdir()
            with (
                mock.patch.object(WRITER, "get_config_path", return_value=config_path),
                mock.patch("builtins.input", return_value=str(vault)),
            ):
                WRITER.setup_config()

            config_text = config_path.read_text(encoding="utf-8")
            self.assertIn("- **Vault 경로**:", config_text)
            self.assertNotIn("- **경로**:", config_text)

    def test_rejects_absolute_traversal_and_cross_platform_paths(self):
        unsafe = (
            ("/tmp/project", "project", False),
            ("../project", "project", False),
            ("nested/project", "project", False),
            (r"C:\project", "project", False),
            ("../meetings", "subfolder", True),
            ("meetings//private", "subfolder", True),
            (r"meetings\private", "subfolder", True),
            ("../note.md", "filename", False),
            ("notes/note.md", "filename", False),
        )
        for value, label, nested in unsafe:
            with self.subTest(value=value):
                with self.assertRaises(WRITER.PathValidationError):
                    WRITER.validate_path_value(value, label, allow_nested=nested)

    def test_writes_only_below_canonical_vault(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            vault = Path(temp_dir) / "vault"
            vault.mkdir()
            result = WRITER.write_document(
                vault,
                project="project",
                subfolder="meetings/weekly",
                filename="note.md",
                content="safe",
            )

            self.assertEqual(result.read_text(encoding="utf-8"), "safe")
            self.assertEqual(
                result.relative_to(vault.resolve()).as_posix(),
                "workspace/project/context/meetings/weekly/note.md",
            )

    @unittest.skipUnless(hasattr(os, "symlink"), "symlinks unavailable")
    def test_rejects_intermediate_symlink_escape_before_write(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            base = Path(temp_dir)
            vault = base / "vault"
            outside = base / "outside"
            context = vault / "workspace" / "project" / "context"
            context.mkdir(parents=True)
            outside.mkdir()
            (context / "escape").symlink_to(outside, target_is_directory=True)

            with self.assertRaises(WRITER.PathValidationError):
                WRITER.write_document(
                    vault,
                    project="project",
                    subfolder="escape",
                    filename="stolen.md",
                    content="must not escape",
                )
            self.assertFalse((outside / "stolen.md").exists())

    @unittest.skipUnless(hasattr(os, "symlink"), "symlinks unavailable")
    def test_rejects_final_symlink_escape_on_overwrite(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            base = Path(temp_dir)
            vault = base / "vault"
            outside = base / "outside"
            context = vault / "workspace" / "project" / "context"
            context.mkdir(parents=True)
            outside.mkdir()
            secret = outside / "secret.md"
            secret.write_text("unchanged", encoding="utf-8")
            (context / "note.md").symlink_to(secret)

            with self.assertRaises(WRITER.PathValidationError):
                WRITER.write_document(
                    vault,
                    project="project",
                    filename="note.md",
                    content="overwrite",
                    overwrite=True,
                )
            self.assertEqual(secret.read_text(encoding="utf-8"), "unchanged")

    @unittest.skipUnless(hasattr(os, "symlink"), "symlinks unavailable")
    def test_extension_is_added_before_symlink_containment_check(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            base = Path(temp_dir)
            vault = base / "vault"
            outside = base / "outside"
            context = vault / "workspace" / "project" / "context"
            context.mkdir(parents=True)
            outside.mkdir()
            secret = outside / "secret.md"
            secret.write_text("unchanged", encoding="utf-8")
            (context / "note.md").symlink_to(secret)

            with self.assertRaises(WRITER.PathValidationError):
                WRITER.write_document(
                    vault,
                    project="project",
                    filename="note",
                    content="overwrite",
                    overwrite=True,
                )
            self.assertEqual(secret.read_text(encoding="utf-8"), "unchanged")

    @unittest.skipUnless(hasattr(os, "symlink"), "symlinks unavailable")
    def test_rejects_symlink_to_directory_inside_vault(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            vault = Path(temp_dir) / "vault"
            context = vault / "workspace" / "project" / "context"
            internal = vault / "internal"
            context.mkdir(parents=True)
            internal.mkdir()
            (context / "alias").symlink_to(internal, target_is_directory=True)

            with self.assertRaises(WRITER.PathValidationError):
                WRITER.write_document(
                    vault,
                    project="project",
                    subfolder="alias",
                    filename="note.md",
                    content="must not follow internal aliases",
                )
            self.assertFalse((internal / "note.md").exists())

    @unittest.skipUnless(hasattr(os, "symlink"), "symlinks unavailable")
    def test_rejects_nested_symlink_component_inside_vault(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            vault = Path(temp_dir) / "vault"
            meetings = vault / "workspace" / "project" / "context" / "meetings"
            internal = vault / "internal"
            meetings.mkdir(parents=True)
            internal.mkdir()
            (meetings / "alias").symlink_to(internal, target_is_directory=True)

            with self.assertRaises(WRITER.PathValidationError):
                WRITER.write_document(
                    vault,
                    project="project",
                    subfolder="meetings/alias/nested",
                    filename="note.md",
                    content="must not follow nested aliases",
                )
            self.assertFalse((internal / "nested" / "note.md").exists())

    @unittest.skipUnless(hasattr(os, "symlink"), "symlinks unavailable")
    def test_rejects_final_symlink_to_file_inside_vault(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            vault = Path(temp_dir) / "vault"
            context = vault / "workspace" / "project" / "context"
            internal = vault / "internal"
            context.mkdir(parents=True)
            internal.mkdir()
            real_document = internal / "real.md"
            real_document.write_text("unchanged", encoding="utf-8")
            (context / "note.md").symlink_to(real_document)

            with self.assertRaises(WRITER.PathValidationError):
                WRITER.write_document(
                    vault,
                    project="project",
                    filename="note.md",
                    content="overwrite",
                    overwrite=True,
                )
            self.assertEqual(real_document.read_text(encoding="utf-8"), "unchanged")

    @unittest.skipUnless(hasattr(os, "symlink"), "symlinks unavailable")
    def test_rejects_vault_root_symlink(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            base = Path(temp_dir)
            real_vault = base / "real-vault"
            vault_alias = base / "vault-alias"
            real_vault.mkdir()
            vault_alias.symlink_to(real_vault, target_is_directory=True)

            with self.assertRaises(WRITER.PathValidationError):
                WRITER.write_document(
                    vault_alias,
                    project="project",
                    filename="note.md",
                    content="must reject root aliases",
                )

    def test_cli_does_not_disclose_host_absolute_paths(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            base = Path(temp_dir)
            fake_home = base / "home"
            vault = base / "private" / "vault"
            project = base / "private" / "project"
            (fake_home / ".agents").mkdir(parents=True)
            vault.mkdir(parents=True)
            project.mkdir(parents=True)
            body_file = base / "document.md"
            body_file.write_text("safe", encoding="utf-8")
            (fake_home / ".agents" / "OBSIDIAN.md").write_text(
                f"- **Vault 경로**: {vault}\n", encoding="utf-8"
            )

            for input_args, stdin in (
                (("--file", str(body_file)), None),
                (("--stdin",), "safe"),
            ):
                with self.subTest(input_args=input_args):
                    result = subprocess.run(
                        [
                            "python3",
                            str(WRITER_PATH),
                            "--project",
                            "project",
                            "--filename",
                            "note.md",
                            *input_args,
                        ],
                        cwd=project,
                        env={**os.environ, "HOME": str(fake_home)},
                        capture_output=True,
                        text=True,
                        input=stdin,
                        check=False,
                    )
                    output = result.stdout + result.stderr
                    self.assertEqual(result.returncode, 0, output)
                    self.assertNotIn(str(base), output)
                    self.assertIn("workspace/project/context/", output)

    def test_cli_validates_target_fields_before_reading_config(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            fake_home = Path(temp_dir) / "empty-home"
            fake_home.mkdir()
            result = subprocess.run(
                [
                    "python3",
                    str(WRITER_PATH),
                    "--project",
                    "../escape",
                    "--stdin",
                ],
                env={**os.environ, "HOME": str(fake_home)},
                capture_output=True,
                text=True,
                input="unsafe",
                check=False,
            )
            output = result.stdout + result.stderr
            self.assertEqual(result.returncode, 2)
            self.assertIn("project", output)
            self.assertNotIn(str(fake_home), output)
            self.assertNotIn("Vault 경로가 설정되지", output)

    def test_cli_rejects_legacy_content_before_writing(self):
        for legacy_argv in (
            ("--content", "private-body"),
            ("--content=private-body",),
        ):
            with self.subTest(argv=legacy_argv):
                result = subprocess.run(
                    ["python3", str(WRITER_PATH), *legacy_argv],
                    capture_output=True,
                    text=True,
                    check=False,
                )
                output = result.stdout + result.stderr
                self.assertEqual(result.returncode, 2)
                self.assertNotIn("private-body", output)

    def test_cli_rejects_multiple_input_modes(self):
        result = subprocess.run(
            [
                "python3",
                str(WRITER_PATH),
                "--file",
                "document.md",
                "--stdin",
            ],
            input="safe",
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 2)

    def test_cli_requires_explicit_input_without_reading_stdin(self):
        class ForbiddenStdin:
            def read(self):
                raise AssertionError("stdin must not be read without --stdin")

        with (
            mock.patch.object(WRITER.sys, "argv", [str(WRITER_PATH)]),
            mock.patch.object(WRITER.sys, "stdin", ForbiddenStdin()),
            mock.patch("sys.stderr"),
            self.assertRaises(SystemExit) as raised,
        ):
            WRITER.main()
        self.assertEqual(raised.exception.code, 2)


class RemotePublishingSecurityTests(unittest.TestCase):
    def test_publish_script_remains_executable(self):
        self.assertTrue(PUBLISH_PATH.stat().st_mode & stat.S_IXUSR)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        self.bin_dir = self.base / "bin"
        self.bin_dir.mkdir()
        self.ssh_log = self.base / "ssh.log"
        self.rsync_log = self.base / "rsync.log"
        self.remote_files = self.base / "remote-files"
        self.remote_collisions = self.base / "remote-collisions"
        self.remote_state_sequence = self.base / "remote-state-sequence"
        self.state_query_count = self.base / "state-query-count"
        self.remote_files.write_text("", encoding="utf-8")
        self.remote_collisions.write_text("", encoding="utf-8")
        self.remote_state_sequence.write_text("", encoding="utf-8")
        self.state_query_count.write_text("0\n", encoding="utf-8")
        self.ssh_stub = self.bin_dir / "ssh"
        self.ssh_stub.write_text(
            """#!/bin/sh
command=
for argument do
  command=$argument
done
printf '%s\\n' "$command" >> "$SSH_STUB_LOG"
case "$command" in
  *'rm --'*) exit 0 ;;
  *root-alias*) exit 40 ;;
  *alias.md*'realpath -m'*) exit 41 ;;
  target=*collision*)
    target=$(printf '%s' "$command" | sed -n "s/^target='\\([^']*\\)'.*/\\1/p")
    if [ -s "$REMOTE_STATE_SEQUENCE_STUB" ]; then
      query=$(cat "$STATE_QUERY_COUNT_STUB")
      query=$((query + 1))
      printf '%s\\n' "$query" > "$STATE_QUERY_COUNT_STUB"
      state=$(sed -n "${query}p" "$REMOTE_STATE_SEQUENCE_STUB")
    elif grep -Fqx -- "$target" "$REMOTE_COLLISIONS_STUB"; then
      state=collision
    elif grep -Fqx -- "$target" "$REMOTE_FILES_STUB"; then
      state=file
    else
      state=absent
    fi
    case "$state" in
      absent|file|collision) printf '%s\\n' "$state" ;;
      *) exit 50 ;;
    esac
    ;;
  *'realpath -e'*) printf '%s\\n' '/srv/docs' ;;
  *escape.md*'realpath -m'*) printf '%s\\n' '/etc/passwd' ;;
  *'realpath -m'*)
    relative=$(printf '%s' "$command" | sed -n "s/^remaining='\\([^']*\\)'.*/\\1/p")
    printf '/srv/docs/%s\\n' "$relative"
    ;;
  *) exit 0 ;;
esac
""",
            encoding="utf-8",
        )
        self.ssh_stub.chmod(0o755)
        self.rsync_stub = self.bin_dir / "rsync"
        self.rsync_stub.write_text(
            """#!/bin/sh
printf '%s\\n' "$@" >> "$RSYNC_STUB_LOG"
exit 0
""",
            encoding="utf-8",
        )
        self.rsync_stub.chmod(0o755)
        self.env = {
            **os.environ,
            "PATH": f"{self.bin_dir}:{os.environ['PATH']}",
            "SSH_STUB_LOG": str(self.ssh_log),
            "RSYNC_STUB_LOG": str(self.rsync_log),
            "REMOTE_FILES_STUB": str(self.remote_files),
            "REMOTE_COLLISIONS_STUB": str(self.remote_collisions),
            "REMOTE_STATE_SEQUENCE_STUB": str(self.remote_state_sequence),
            "STATE_QUERY_COUNT_STUB": str(self.state_query_count),
            "DOCS_HOST": "docs.example.test",
            "DOCS_USER": "publisher",
            "DOCS_ROOT": "/srv/docs",
            "DOCS_URL": "https://docs.example.test",
        }

    def tearDown(self):
        self.temp.cleanup()

    def run_publish(self, *args, env=None, stdin=None):
        return subprocess.run(
            ["bash", str(PUBLISH_PATH), *args],
            env=env or self.env,
            input=stdin,
            capture_output=True,
            text=True,
            check=False,
        )

    def ssh_commands(self):
        if not self.ssh_log.exists():
            return ""
        return self.ssh_log.read_text(encoding="utf-8")

    def rsync_arguments(self):
        if not self.rsync_log.exists():
            return ""
        return self.rsync_log.read_text(encoding="utf-8")

    def set_remote_files(self, *targets):
        self.remote_files.write_text(
            "".join(f"/srv/docs/{target}\n" for target in targets),
            encoding="utf-8",
        )

    def set_remote_collisions(self, *targets):
        self.remote_collisions.write_text(
            "".join(f"/srv/docs/{target}\n" for target in targets),
            encoding="utf-8",
        )

    def set_remote_state_sequence(self, *states):
        self.remote_state_sequence.write_text(
            "".join(f"{state}\n" for state in states), encoding="utf-8"
        )
        self.state_query_count.write_text("0\n", encoding="utf-8")

    def test_rejects_missing_and_root_docs_root_before_ssh(self):
        for root in ("", "/", "/srv/../etc", "relative/docs"):
            with self.subTest(root=root):
                self.ssh_log.unlink(missing_ok=True)
                env = {**self.env, "DOCS_ROOT": root}
                result = self.run_publish("read", "note", env=env)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(self.ssh_commands(), "")

    def test_rejects_document_traversal_before_ssh(self):
        result = self.run_publish("read", "../secret")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.ssh_commands(), "")
        self.assertNotIn("../secret", result.stdout + result.stderr)

    def test_missing_argument_does_not_disclose_script_path(self):
        result = self.run_publish("read")
        output = result.stdout + result.stderr
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn(str(INTEGRATION_ROOT), output)
        self.assertEqual(self.ssh_commands(), "")

    def test_rejects_canonical_target_escape_without_disclosing_paths(self):
        result = self.run_publish("read", "escape")
        output = result.stdout + result.stderr
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("/srv/docs", output)
        self.assertNotIn("/etc/passwd", output)
        self.assertIn("escapes DOCS_ROOT", output)

    def test_rejects_remote_root_symlink_alias(self):
        env = {**self.env, "DOCS_ROOT": "/srv/root-alias"}
        result = self.run_publish("read", "note", env=env)
        output = result.stdout + result.stderr
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("/srv/root-alias", output)

    def test_delete_rejects_internal_symlink_alias_even_with_approval(self):
        result = self.run_publish("delete", "alias", "--approve=alias")
        output = result.stdout + result.stderr
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("rm --", self.ssh_commands())
        self.assertNotIn("/srv/docs", output)

    @unittest.skipUnless(hasattr(os, "symlink"), "symlinks unavailable")
    def test_directory_push_rejects_nested_source_symlink_before_remote_io(self):
        source = self.base / "source"
        nested = source / "nested"
        nested.mkdir(parents=True)
        target = source / "real.md"
        target.write_text("safe", encoding="utf-8")
        (nested / "alias.md").symlink_to(target)

        result = self.run_publish("push", str(source))
        output = result.stdout + result.stderr
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("symbolic link", output)
        self.assertEqual(self.ssh_commands(), "")
        self.assertEqual(self.rsync_arguments(), "")

    def test_directory_push_uses_no_links_defense(self):
        source = self.base / "source"
        source.mkdir()
        (source / "note.md").write_text("safe", encoding="utf-8")

        result = self.run_publish("push", str(source))
        output = result.stdout + result.stderr
        self.assertEqual(result.returncode, 0, output)
        self.assertIn("--no-links", self.rsync_arguments())
        self.assertIn(f"{source}/", self.rsync_arguments())

    def test_file_push_requires_exact_target_overwrite_approval(self):
        source = self.base / "note.md"
        source.write_text("replacement", encoding="utf-8")
        self.set_remote_files("note.md")

        refused = self.run_publish("push", str(source))
        refused_output = refused.stdout + refused.stderr
        self.assertNotEqual(refused.returncode, 0)
        self.assertIn("docs-root/note.md", refused_output)
        self.assertIn("--approve-overwrite=note.md", refused_output)
        self.assertNotIn("/srv/docs", refused_output)
        self.assertEqual(self.rsync_arguments(), "")

        wrong = self.run_publish(
            "push", str(source), "--approve-overwrite=other.md"
        )
        self.assertNotEqual(wrong.returncode, 0)
        self.assertEqual(self.rsync_arguments(), "")

        self.ssh_log.unlink(missing_ok=True)
        approved = self.run_publish(
            "push", str(source), "--approve-overwrite=note.md"
        )
        approved_output = approved.stdout + approved.stderr
        self.assertEqual(approved.returncode, 0, approved_output)
        self.assertIn(str(source), self.rsync_arguments())
        state_checks = [
            command
            for command in self.ssh_commands().splitlines()
            if command.startswith("target='/srv/docs/note.md'")
        ]
        self.assertEqual(len(state_checks), 2)

    def test_file_push_rechecks_absence_before_upload(self):
        source = self.base / "new.md"
        source.write_text("new", encoding="utf-8")
        self.set_remote_state_sequence("absent", "file")

        result = self.run_publish("push", str(source))
        output = result.stdout + result.stderr
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("existence changed", output)
        self.assertEqual(self.rsync_arguments(), "")

    def test_new_file_push_succeeds_without_overwrite_approval(self):
        source = self.base / "new.md"
        source.write_text("new", encoding="utf-8")

        result = self.run_publish("push", str(source))
        output = result.stdout + result.stderr
        self.assertEqual(result.returncode, 0, output)
        self.assertIn("docs-root/new.md", output)
        self.assertIn(str(source), self.rsync_arguments())

    def test_remote_existence_check_failure_is_fail_closed(self):
        source = self.base / "new.md"
        source.write_text("new", encoding="utf-8")
        self.set_remote_state_sequence("invalid")

        result = self.run_publish("push", str(source))
        output = result.stdout + result.stderr
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("existence could not be checked", output)
        self.assertEqual(self.rsync_arguments(), "")

    def test_write_approval_uses_exact_final_markdown_target(self):
        target = "2026-08-12-note.md"
        self.set_remote_files(target)

        refused = self.run_publish("write", target, stdin="replacement")
        refused_output = refused.stdout + refused.stderr
        self.assertNotEqual(refused.returncode, 0)
        self.assertIn(f"docs-root/{target}", refused_output)
        self.assertIn(f"--approve-overwrite={target}", refused_output)
        self.assertNotIn("cat >", self.ssh_commands())

        self.ssh_log.unlink(missing_ok=True)
        approved = self.run_publish(
            "write",
            target,
            f"--approve-overwrite={target}",
            stdin="replacement",
        )
        approved_output = approved.stdout + approved.stderr
        self.assertEqual(approved.returncode, 0, approved_output)
        self.assertIn("cat > '/srv/docs/2026-08-12-note.md'", self.ssh_commands())

    def test_exact_approval_cannot_replace_non_file_collision(self):
        source = self.base / "note.md"
        source.write_text("replacement", encoding="utf-8")
        self.set_remote_collisions("note.md")

        result = self.run_publish(
            "push", str(source), "--approve-overwrite=note.md"
        )
        output = result.stdout + result.stderr
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("not a replaceable regular file", output)
        self.assertEqual(self.rsync_arguments(), "")

    def test_directory_push_rejects_any_target_collision(self):
        source = self.base / "source"
        nested = source / "nested"
        nested.mkdir(parents=True)
        (nested / "note.md").write_text("replacement", encoding="utf-8")
        self.set_remote_files("nested/note.md")

        result = self.run_publish("push", str(source))
        output = result.stdout + result.stderr
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("docs-root/nested/note.md", output)
        self.assertIn("already exists", output)
        self.assertNotIn("/srv/docs", output)
        self.assertEqual(self.rsync_arguments(), "")

        bulk = self.run_publish(
            "push", str(source), "--approve-overwrite=nested/note.md"
        )
        self.assertNotEqual(bulk.returncode, 0)
        self.assertIn("do not accept bulk overwrite", bulk.stdout + bulk.stderr)
        self.assertEqual(self.rsync_arguments(), "")

    def test_delete_requires_exact_name_approval_after_preview(self):
        first = self.run_publish("delete", "note")
        first_output = first.stdout + first.stderr
        self.assertNotEqual(first.returncode, 0)
        self.assertIn("docs-root/note.md", first_output)
        self.assertNotIn("/srv/docs", first_output)
        self.assertNotIn("rm --", self.ssh_commands())

        self.ssh_log.unlink(missing_ok=True)
        wrong = self.run_publish("delete", "note", "--approve=other")
        self.assertNotEqual(wrong.returncode, 0)
        self.assertNotIn("rm --", self.ssh_commands())

        self.ssh_log.unlink(missing_ok=True)
        approved = self.run_publish("delete", "note", "--approve=note")
        approved_output = approved.stdout + approved.stderr
        self.assertEqual(approved.returncode, 0, approved_output)
        self.assertIn("rm --", self.ssh_commands())
        self.assertNotIn("/srv/docs", approved_output)


if __name__ == "__main__":
    unittest.main()
