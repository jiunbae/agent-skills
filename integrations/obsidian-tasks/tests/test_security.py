import contextlib
import importlib.util
import io
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


SKILL_DIR = Path(__file__).resolve().parents[1]
SCRIPT = SKILL_DIR / "scripts" / "obsidian-tasks.py"


def load_script_module():
    spec = importlib.util.spec_from_file_location("obsidian_tasks", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


OBSIDIAN_TASKS = load_script_module()


class IsolatedFixture:
    def __init__(self, *, enabled: bool = True):
        self.tempdir = tempfile.TemporaryDirectory()
        self.root = Path(self.tempdir.name)
        self.home = self.root / "home"
        self.vault = self.root / "vault"
        self.config = self.home / ".agents" / "OBSIDIAN.md"
        self.config.parent.mkdir(parents=True)
        self.vault.mkdir()
        self.set_enabled(enabled)

    def set_enabled(self, enabled: bool):
        value = "true" if enabled else "false"
        self.config.write_text(
            "\n".join(
                [
                    "# Obsidian 설정",
                    "",
                    f"- **경로**: {self.vault}",
                    f"- **활성화**: {value}",
                    "- **자동 링크**: true",
                    "",
                ]
            ),
            encoding="utf-8",
        )

    def run(self, *args: str) -> subprocess.CompletedProcess:
        env = os.environ.copy()
        env["HOME"] = str(self.home)
        env["PYTHONDONTWRITEBYTECODE"] = "1"
        return subprocess.run(
            [sys.executable, str(SCRIPT), *args],
            cwd=SKILL_DIR,
            env=env,
            text=True,
            capture_output=True,
            check=False,
        )

    def close(self):
        self.tempdir.cleanup()


class SecurityTests(unittest.TestCase):
    def setUp(self):
        self.fixture = IsolatedFixture()

    def tearDown(self):
        self.fixture.close()

    def assert_no_absolute_disclosure(self, result: subprocess.CompletedProcess):
        output = result.stdout + result.stderr
        self.assertNotIn(str(self.fixture.root), output)
        self.assertNotIn(str(self.fixture.root.resolve()), output)
        self.assertNotIn(str(self.fixture.vault), output)
        self.assertNotIn(str(self.fixture.vault.resolve()), output)

    def init_taskmanager(self):
        result = self.fixture.run("--init")
        self.assertEqual(result.returncode, 0, result.stderr)
        return self.fixture.vault / "TaskManager"

    def create_task_file(self, task_id: str = "task-001") -> Path:
        taskmanager = self.init_taskmanager()
        note = taskmanager / "Notes" / f"{task_id}.md"
        note.write_text(
            "\n".join(
                [
                    "---",
                    f"task_id: {task_id}",
                    "title: fixture",
                    "status: backlog",
                    "linked_docs: []",
                    "---",
                    "",
                    "# fixture",
                    "",
                ]
            ),
            encoding="utf-8",
        )
        return note

    def test_disabled_setting_centrally_blocks_every_action_and_resolver(self):
        self.fixture.set_enabled(False)
        commands = [
            ("--init",),
            ("--list",),
            ("--board",),
            ("--read", "task-001"),
            ("--search", "fixture"),
            ("--create", "--title", "fixture", "--project", "safe"),
            ("--start", "task-001", "--project", "safe"),
            ("--complete", "task-001"),
            ("--update-status", "task-001", "--new-status", "done"),
            ("--link", "task-001", "--project", "safe"),
        ]

        for command in commands:
            with self.subTest(command=command):
                result = self.fixture.run(*command)
                self.assertEqual(result.returncode, 2)
                self.assertIn("비활성화", result.stderr)
                self.assert_no_absolute_disclosure(result)
        self.assertFalse((self.fixture.vault / "TaskManager").exists())

        check = self.fixture.run("--check")
        self.assertEqual(check.returncode, 0, check.stderr)
        self.assertIn("TaskManager 활성화: false", check.stdout)
        self.assert_no_absolute_disclosure(check)

        with mock.patch.object(
            OBSIDIAN_TASKS,
            "get_config_path",
            return_value=self.fixture.config,
        ):
            self.assertIsNone(OBSIDIAN_TASKS.get_vault_path())
            self.assertIsNone(OBSIDIAN_TASKS.get_taskmanager_path())
            self.assertIsNone(OBSIDIAN_TASKS.get_notes_path())
            self.assertIsNone(OBSIDIAN_TASKS.get_task_note_path("task-001"))

    def test_absolute_and_traversal_task_or_project_inputs_are_rejected(self):
        self.init_taskmanager()
        cases = [
            ("--read", "../../outside"),
            ("--read", str(self.fixture.root / "outside")),
            ("--link", "task-001", "--project", "../outside"),
            ("--link", "task-001", "--project", str(self.fixture.root / "outside")),
        ]

        for command in cases:
            with self.subTest(command=command):
                result = self.fixture.run(*command)
                self.assertEqual(result.returncode, 2)
                self.assert_no_absolute_disclosure(result)
        self.assertFalse((self.fixture.root / "outside" / "active-tasks.md").exists())

    def test_task_note_symlink_cannot_escape_for_read_or_write(self):
        taskmanager = self.init_taskmanager()
        outside = self.fixture.root / "outside-task.md"
        original = "secret outside content\nstatus: backlog\n"
        outside.write_text(original, encoding="utf-8")
        (taskmanager / "Notes" / "task-999.md").symlink_to(outside)

        for command in (("--read", "task-999", "--json"), ("--complete", "task-999")):
            with self.subTest(command=command):
                result = self.fixture.run(*command)
                self.assertEqual(result.returncode, 2)
                self.assertNotIn("secret outside content", result.stdout + result.stderr)
                self.assert_no_absolute_disclosure(result)
        self.assertEqual(outside.read_text(encoding="utf-8"), original)

    def test_project_symlink_cannot_escape_on_link(self):
        note = self.create_task_file()
        original_note = note.read_text(encoding="utf-8")
        outside_project = self.fixture.root / "outside-project"
        outside_project.mkdir()
        workspace = self.fixture.vault / "workspace"
        workspace.mkdir()
        (workspace / "escape").symlink_to(outside_project, target_is_directory=True)

        result = self.fixture.run("--link", "task-001", "--project", "escape")
        self.assertEqual(result.returncode, 2)
        self.assertFalse((outside_project / "context" / "active-tasks.md").exists())
        self.assertEqual(note.read_text(encoding="utf-8"), original_note)
        self.assert_no_absolute_disclosure(result)

    def test_project_symlink_cannot_escape_workspace_even_within_vault(self):
        note = self.create_task_file()
        original_note = note.read_text(encoding="utf-8")
        inside_vault_but_outside_workspace = self.fixture.vault / "other-project"
        inside_vault_but_outside_workspace.mkdir()
        workspace = self.fixture.vault / "workspace"
        workspace.mkdir()
        (workspace / "escape").symlink_to(
            inside_vault_but_outside_workspace,
            target_is_directory=True,
        )

        result = self.fixture.run("--link", "task-001", "--project", "escape")
        self.assertEqual(result.returncode, 2)
        self.assertFalse(
            (inside_vault_but_outside_workspace / "context" / "active-tasks.md").exists()
        )
        self.assertEqual(note.read_text(encoding="utf-8"), original_note)
        self.assert_no_absolute_disclosure(result)

    def test_managed_file_symlink_cannot_escape_and_outputs_are_relative(self):
        taskmanager = self.init_taskmanager()
        outside_board = self.fixture.root / "outside-board.md"
        outside_board.write_text("top secret", encoding="utf-8")
        (taskmanager / "Board.md").unlink()
        (taskmanager / "Board.md").symlink_to(outside_board)

        blocked = self.fixture.run("--board")
        self.assertEqual(blocked.returncode, 2)
        self.assertNotIn("top secret", blocked.stdout + blocked.stderr)
        self.assert_no_absolute_disclosure(blocked)

        (taskmanager / "Board.md").unlink()
        init_again = self.fixture.run("--init")
        self.assertEqual(init_again.returncode, 0, init_again.stderr)
        created = self.fixture.run(
            "--create",
            "--title",
            "fixture",
            "--project",
            "safe",
        )
        self.assertEqual(created.returncode, 0, created.stderr)
        self.assertIn("TaskManager/Notes/task-001.md", created.stdout)
        self.assert_no_absolute_disclosure(created)

        read = self.fixture.run("--read", "task-001", "--json")
        self.assertEqual(read.returncode, 0, read.stderr)
        self.assertNotIn('"path"', read.stdout)
        self.assert_no_absolute_disclosure(read)


class TruthfulnessTests(unittest.TestCase):
    def setUp(self):
        self.fixture = IsolatedFixture()

    def tearDown(self):
        self.fixture.close()

    def assert_no_absolute_disclosure(self, result: subprocess.CompletedProcess):
        output = result.stdout + result.stderr
        self.assertNotIn(str(self.fixture.root), output)
        self.assertNotIn(str(self.fixture.vault), output)

    def init_taskmanager(self) -> Path:
        result = self.fixture.run("--init")
        self.assertEqual(result.returncode, 0, result.stderr)
        return self.fixture.vault / "TaskManager"

    def create_task(self) -> tuple[Path, Path]:
        taskmanager = self.init_taskmanager()
        result = self.fixture.run(
            "--create",
            "--title",
            "fixture",
            "--project",
            "safe",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return taskmanager, taskmanager / "Notes" / "task-001.md"

    def test_create_rejects_malformed_board_or_table_before_note_creation(self):
        cases = {
            "Board.md": "# malformed board\n",
            "Table.md": "| Task | Status |\n|---|---|\n",
        }

        for filename, malformed_content in cases.items():
            with self.subTest(filename=filename):
                self.fixture.close()
                self.fixture = IsolatedFixture()
                taskmanager = self.init_taskmanager()
                (taskmanager / filename).write_text(
                    malformed_content,
                    encoding="utf-8",
                )

                result = self.fixture.run(
                    "--create",
                    "--title",
                    "fixture",
                    "--project",
                    "safe",
                )

                self.assertEqual(result.returncode, 1)
                self.assertNotIn("작업 생성됨", result.stdout + result.stderr)
                self.assertFalse((taskmanager / "Notes" / "task-001.md").exists())
                self.assert_no_absolute_disclosure(result)

    def test_missing_board_or_table_fails_before_note_status_mutation(self):
        cases = (
            ("Board.md", ("--start", "task-001", "--project", "safe")),
            (
                "Table.md",
                ("--update-status", "task-001", "--new-status", "review"),
            ),
        )

        for filename, command in cases:
            with self.subTest(filename=filename):
                self.fixture.close()
                self.fixture = IsolatedFixture()
                taskmanager, note = self.create_task()
                original_note = note.read_text(encoding="utf-8")
                (taskmanager / filename).unlink()

                result = self.fixture.run(*command)

                self.assertEqual(result.returncode, 1)
                self.assertEqual(note.read_text(encoding="utf-8"), original_note)
                self.assert_no_absolute_disclosure(result)

    def test_not_found_mutations_return_nonzero_without_success_output(self):
        self.init_taskmanager()
        cases = (
            (("--start", "task-999", "--project", "safe"), "작업 시작:"),
            (("--complete", "task-999"), "작업 완료:"),
            (
                ("--update-status", "task-999", "--new-status", "done"),
                "상태 변경:",
            ),
            (("--link", "task-999", "--project", "safe"), "연동 완료:"),
        )

        for command, success_text in cases:
            with self.subTest(command=command):
                result = self.fixture.run(*command)
                self.assertEqual(result.returncode, 1)
                self.assertNotIn(success_text, result.stdout + result.stderr)
                self.assert_no_absolute_disclosure(result)

    def test_success_is_reported_after_all_required_files_are_updated(self):
        taskmanager, note = self.create_task()

        started = self.fixture.run(
            "--start",
            "task-001",
            "--project",
            "safe",
        )
        self.assertEqual(started.returncode, 0, started.stderr)
        self.assertIn("작업 시작: task-001", started.stdout)
        self.assertIn("status: in-progress", note.read_text(encoding="utf-8"))
        self.assertIn(
            "[[Notes/task-001]]",
            (taskmanager / "Board.md").read_text(encoding="utf-8"),
        )
        self.assertIn(
            "| in-progress |",
            (taskmanager / "Table.md").read_text(encoding="utf-8"),
        )

        link_file = self.fixture.vault / "workspace" / "safe" / "context" / "active-tasks.md"
        self.assertTrue(link_file.exists())
        linked_again = self.fixture.run(
            "--link",
            "task-001",
            "--project",
            "safe",
        )
        self.assertEqual(linked_again.returncode, 0, linked_again.stderr)
        self.assertEqual(
            link_file.read_text(encoding="utf-8").count(
                "[[TaskManager/Notes/task-001|fixture]]"
            ),
            1,
        )

        completed = self.fixture.run("--complete", "task-001")
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertIn("작업 완료: task-001", completed.stdout)
        self.assertIn("status: done", note.read_text(encoding="utf-8"))
        self.assertIn(
            "| done |",
            (taskmanager / "Table.md").read_text(encoding="utf-8"),
        )
        self.assert_no_absolute_disclosure(started)
        self.assert_no_absolute_disclosure(linked_again)
        self.assert_no_absolute_disclosure(completed)

    def run_module_cli(self, *args: str) -> tuple[int, str]:
        stdout = io.StringIO()
        stderr = io.StringIO()
        with (
            mock.patch.object(sys, "argv", [str(SCRIPT), *args]),
            mock.patch.object(
                OBSIDIAN_TASKS,
                "parse_config",
                return_value={"taskmanager_enabled": True, "auto_link": False},
            ),
            contextlib.redirect_stdout(stdout),
            contextlib.redirect_stderr(stderr),
        ):
            result = OBSIDIAN_TASKS.run_cli()
        return result, stdout.getvalue() + stderr.getvalue()

    def test_false_create_helper_prevents_success_and_returns_nonzero(self):
        with (
            mock.patch.object(OBSIDIAN_TASKS, "generate_task_id", return_value="task-001"),
            mock.patch.object(OBSIDIAN_TASKS, "can_add_task_to_board", return_value=True),
            mock.patch.object(OBSIDIAN_TASKS, "can_add_task_to_table", return_value=True),
            mock.patch.object(
                OBSIDIAN_TASKS,
                "create_task_note",
                return_value=Path("TaskManager/Notes/task-001.md"),
            ),
            mock.patch.object(OBSIDIAN_TASKS, "add_task_to_board", return_value=False),
        ):
            result, output = self.run_module_cli(
                "--create",
                "--title",
                "fixture",
                "--project",
                "safe",
            )

        self.assertEqual(result, 1)
        self.assertNotIn("작업 생성됨", output)

    def test_false_start_complete_update_and_link_helpers_are_failures(self):
        task = {"frontmatter": {"title": "fixture"}}
        with (
            mock.patch.object(OBSIDIAN_TASKS, "read_task_note", return_value=task),
            mock.patch.object(OBSIDIAN_TASKS, "can_update_task_status", return_value=True),
            mock.patch.object(OBSIDIAN_TASKS, "can_move_task_on_board", return_value=True),
            mock.patch.object(OBSIDIAN_TASKS, "can_update_table_status", return_value=True),
            mock.patch.object(OBSIDIAN_TASKS, "update_task_status", return_value=False),
        ):
            start_result, start_output = self.run_module_cli(
                "--start",
                "task-001",
                "--project",
                "safe",
            )

        self.assertEqual(start_result, 1)
        self.assertNotIn("작업 시작: task-001", start_output)

        with (
            mock.patch.object(OBSIDIAN_TASKS, "read_task_note", return_value=task),
            mock.patch.object(OBSIDIAN_TASKS, "can_update_task_status", return_value=True),
            mock.patch.object(OBSIDIAN_TASKS, "can_move_task_on_board", return_value=True),
            mock.patch.object(OBSIDIAN_TASKS, "can_update_table_status", return_value=True),
            mock.patch.object(OBSIDIAN_TASKS, "update_task_status", return_value=True),
            mock.patch.object(OBSIDIAN_TASKS, "move_task_on_board", return_value=False),
        ):
            complete_result, complete_output = self.run_module_cli(
                "--complete",
                "task-001",
            )

        self.assertEqual(complete_result, 1)
        self.assertNotIn("작업 완료: task-001", complete_output)

        with (
            mock.patch.object(OBSIDIAN_TASKS, "read_task_note", return_value=task),
            mock.patch.object(OBSIDIAN_TASKS, "can_update_task_status", return_value=True),
            mock.patch.object(OBSIDIAN_TASKS, "can_update_table_status", return_value=True),
            mock.patch.object(OBSIDIAN_TASKS, "update_task_status", return_value=True),
            mock.patch.object(OBSIDIAN_TASKS, "update_table_status", return_value=False),
        ):
            update_result, update_output = self.run_module_cli(
                "--update-status",
                "task-001",
                "--new-status",
                "done",
            )

        self.assertEqual(update_result, 1)
        self.assertNotIn("상태 변경: task-001", update_output)

        with (
            mock.patch.object(OBSIDIAN_TASKS, "read_task_note", return_value=task),
            mock.patch.object(OBSIDIAN_TASKS, "can_link_task_to_workspace", return_value=True),
            mock.patch.object(OBSIDIAN_TASKS, "link_task_to_workspace", return_value=False),
        ):
            link_result, link_output = self.run_module_cli(
                "--link",
                "task-001",
                "--project",
                "safe",
            )

        self.assertEqual(link_result, 1)
        self.assertNotIn("연동 완료: task-001", link_output)


if __name__ == "__main__":
    unittest.main()
