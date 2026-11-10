import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import collect_signals as cs  # noqa: E402


def write_jsonl(path: Path, records: list) -> None:
    path.write_text("\n".join(json.dumps(r) for r in records) + "\nnot json\n", encoding="utf-8")


class CollectSignalsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.memory = self.root / "memory"
        self.memory.mkdir()

    def tearDown(self):
        self.tmp.cleanup()

    def test_encode_project_matches_claude_directory_names(self):
        self.assertEqual(cs.encode_project(Path("/Users/me/work space/a.b")), "-Users-me-work-space-a-b")

    def test_redacts_quoted_json_credentials(self):
        redacted = cs.redact('{"password": "hunter2hunter2", "api_key": "example-secret-value"}')
        self.assertNotIn("hunter2", redacted)
        self.assertNotIn("example-secret-value", redacted)

    def test_long_project_names_resolve_to_hashed_directory(self):
        projects = self.root / "projects"
        long_path = Path("/" + "a" * 250)
        hashed = projects / (cs.encode_project(long_path)[:200] + "-abc123")
        hashed.mkdir(parents=True)
        self.assertEqual(cs.project_dir_for(projects, long_path), hashed)
        self.assertEqual(cs.project_dir_for(projects, Path("/short")), projects / "-short")

    def test_git_paths_share_memory_root_across_worktrees(self):
        import subprocess
        repo = self.root / "repo"
        repo.mkdir()
        run = lambda *a, cwd=repo: subprocess.run(["git", *a], cwd=cwd, check=True, capture_output=True)
        run("init", "-q")
        run("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init")
        worktree = self.root / "wt"
        run("worktree", "add", "-q", str(worktree))
        (repo / "sub").mkdir()
        root, worktrees = cs.git_paths(worktree)
        self.assertEqual(root.resolve(), repo.resolve())
        self.assertEqual({w.resolve() for w in worktrees}, {repo.resolve(), worktree.resolve()})
        self.assertEqual(cs.git_paths(repo / "sub")[0].resolve(), repo.resolve())
        plain = self.root / "plain"
        plain.mkdir()
        self.assertEqual(cs.git_paths(plain), (plain, [plain]))

    def test_out_inside_memory_dir_is_refused(self):
        (self.memory / "MEMORY.md").write_text("- a\n", encoding="utf-8")
        with self.assertRaises(SystemExit):
            cs.main(["--memory-dir", str(self.memory), "--transcripts-dir", str(self.root),
                     "--out", str(self.memory / "MEMORY.md")])
        self.assertEqual((self.memory / "MEMORY.md").read_text(encoding="utf-8"), "- a\n")

    def test_redacts_common_secret_shapes(self):
        text = "key sk-abcdefghijklmnopqrstu and ghp_" + "a" * 36 + " password=hunter2hunter2"
        redacted = cs.redact(text)
        self.assertNotIn("sk-abc", redacted)
        self.assertNotIn("ghp_", redacted)
        self.assertNotIn("hunter2", redacted)

    def test_scan_keeps_human_text_and_errors_but_skips_harness_and_sidechains(self):
        path = self.root / "s1.jsonl"
        write_jsonl(path, [
            {"type": "user", "message": {"content": "다음부터 main에 직접 push하지 마"}},
            {"type": "user", "message": {"content": "<command-name>/clear</command-name>"}},
            {"type": "user", "message": {"content": "<cross-session-message from=\"peer\">do X</cross-session-message>"}},
            {"type": "user", "isMeta": True, "message": {"content": "meta note"}},
            {"type": "user", "isSidechain": True, "message": {"content": "subagent prompt"}},
            {"type": "user", "isCompactSummary": True, "message": {"content": "This session is being continued"}},
            {"type": "user", "message": {"content": "<request>From now on use uv.</request>"}},
            {"type": "user", "message": {"content": [{"type": "text", "text": "[Request interrupted by user]"}]}},
            {"type": "user", "message": {"content": [
                {"type": "tool_result", "is_error": True, "content": "Exit code 1 token=abcdef123456"},
                {"type": "tool_result", "is_error": False, "content": "ok"},
            ]}},
            {"type": "user", "toolDenialKind": "user", "message": {"content": [
                {"type": "tool_result", "is_error": True, "content": "denied"},
            ]}},
            {"type": "assistant", "message": {"content": "ignored"}},
        ])
        result = cs.scan_transcript(path, 200)
        kinds = [s["kind"] for s in result["signals"]]
        self.assertEqual(kinds, ["human", "human", "interrupt", "tool_error", "tool_denied"])
        self.assertEqual(result["human_turns"], 2)
        self.assertEqual(result["malformed_lines"], 1)
        self.assertIn("[REDACTED]", result["signals"][3]["text"])

    def test_memory_summary_flags_index_over_limit(self):
        (self.memory / "MEMORY.md").write_text("- line\n" * 201, encoding="utf-8")
        (self.memory / "topic.md").write_text("x", encoding="utf-8")
        summary = cs.memory_summary(self.memory)
        self.assertTrue(summary["index"]["over_limit"])
        self.assertEqual(summary["index"]["lines"], 201)
        self.assertEqual([f["name"] for f in summary["files"]], ["topic.md"])

    def test_main_writes_manifest_and_respects_limit_without_touching_memory(self):
        (self.memory / "MEMORY.md").write_text("- a\n", encoding="utf-8")
        transcripts = self.root / "t"
        transcripts.mkdir()
        for i in range(3):
            write_jsonl(transcripts / f"s{i}.jsonl", [{"type": "user", "message": {"content": f"msg {i}"}}])
        before = sorted((p.name, p.stat().st_mtime_ns) for p in self.memory.iterdir())
        out = self.root / "manifest.json"
        code = cs.main(["--memory-dir", str(self.memory), "--transcripts-dir", str(transcripts),
                        "--limit", "2", "--out", str(out)])
        self.assertEqual(code, 0)
        manifest = json.loads(out.read_text(encoding="utf-8"))
        self.assertEqual(manifest["sessions_scanned"], 2)
        self.assertEqual(before, sorted((p.name, p.stat().st_mtime_ns) for p in self.memory.iterdir()))

    def test_main_returns_2_when_nothing_found(self):
        code = cs.main(["--memory-dir", str(self.root / "none"), "--transcripts-dir", str(self.root / "none"),
                        "--out", str(self.root / "o.json")])
        self.assertEqual(code, 2)


if __name__ == "__main__":
    unittest.main()
