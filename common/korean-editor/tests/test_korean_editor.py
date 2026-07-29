from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SKILL_ROOT = Path(__file__).resolve().parents[1]


def load_module(name: str, relative_path: str):
    spec = importlib.util.spec_from_file_location(name, SKILL_ROOT / relative_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


sys.path.insert(0, str(SKILL_ROOT / "scripts"))

ANALYZE = load_module("korean_editor_analyze", "scripts/analyze_korean.py")
VERIFY = load_module("korean_editor_verify", "scripts/verify_fidelity.py")
BUILD = load_module("korean_editor_build", "scripts/build_runtime_rules.py")
RULES = json.loads((SKILL_ROOT / "references" / "editing-rules.json").read_text(encoding="utf-8"))


class AnalyzeKoreanTests(unittest.TestCase):
    def test_natural_text_has_no_configured_signal(self) -> None:
        report = ANALYZE.analyze("배포가 끝났습니다. 오류가 없는지 로그를 한 번 더 확인하겠습니다.", RULES)
        self.assertEqual(report["edit_scope_hint"], "none")
        self.assertEqual(report["findings"], [])

    def test_high_confidence_signals_are_reported(self) -> None:
        text = "결과가 잘못 되어진다. 이는 시장 변화를 시사하는 바가 크다."
        report = ANALYZE.analyze(text, RULES)
        ids = {finding["id"] for finding in report["findings"]}
        self.assertIn("TR-04", ids)
        self.assertIn("TP-02", ids)
        self.assertNotIn("ai_score", report)

    def test_threshold_prevents_single_bold_signal(self) -> None:
        report = ANALYZE.analyze("이 문장에서 **핵심어**만 강조한다.", RULES)
        self.assertNotIn("FM-01", {finding["id"] for finding in report["findings"]})

    def test_every_rule_regex_compiles(self) -> None:
        report = ANALYZE.analyze("테스트 문장", RULES)
        self.assertEqual(report["kind"], "editorial_signal_report")

    def test_rule_ids_are_unique(self) -> None:
        ids = [rule["id"] for rule in RULES["rules"]]
        self.assertEqual(len(ids), len(set(ids)))

    def test_code_blocks_do_not_produce_signals(self) -> None:
        text = "정상 문장이다.\n\n```python\n# 결론적으로 이 값은 되어진다\nvalue = 1\n```\n"
        report = ANALYZE.analyze(text, RULES)
        self.assertEqual(report["findings"], [])

    def test_inline_code_and_urls_are_masked(self) -> None:
        report = ANALYZE.analyze("`결론적으로` 와 https://example.com/a?q=%EA%B2%B0 만 있다.", RULES)
        self.assertEqual(report["findings"], [])

    def test_prose_outside_code_still_matches(self) -> None:
        text = "```python\nvalue = 1\n```\n\n결과가 잘못 되어진다."
        report = ANALYZE.analyze(text, RULES)
        self.assertIn("TR-04", {finding["id"] for finding in report["findings"]})

    def test_examples_report_original_line_numbers(self) -> None:
        text = "```python\nvalue = 1\n```\n\n결과가 잘못 되어진다."
        report = ANALYZE.analyze(text, RULES)
        example = next(f for f in report["findings"] if f["id"] == "TR-04")["examples"][0]
        self.assertEqual(example["line"], 5)
        self.assertEqual(example["match"], "되어진")

    def test_findings_carry_rule_exceptions(self) -> None:
        report = ANALYZE.analyze("결과가 잘못 되어진다.", RULES)
        finding = next(f for f in report["findings"] if f["id"] == "TR-04")
        self.assertTrue(finding["exceptions"])

    def test_translationese_paragraph_is_detected(self) -> None:
        text = (
            "이번 프로젝트에 대한 검토를 진행하였습니다. 성능 개선과 관련하여 사항을 공유드립니다.\n"
            "캐시 도입으로 인해 속도가 개선될 것으로 나타났습니다. 모니터링 부재로 인해 리스크가 있습니다.\n"
            "기술적인 관점에서 볼 때 확장 가능한 구조를 지향한다고 할 수 있습니다. 운영 측면에서 보완이 요구됩니다."
        )
        report = ANALYZE.analyze(text, RULES)
        ids = {finding["id"] for finding in report["findings"]}
        self.assertTrue({"TR-07", "TR-08", "TP-05", "HG-04", "VB-04", "VB-05"} <= ids, ids)
        self.assertEqual(report["edit_scope_hint"], "standard")

    def test_scope_hint_uses_density_not_raw_count(self) -> None:
        clean_tail = "어제 배포한 캐시 계층이 잘 돌아간다. 응답 시간도 안정적이다. " * 40
        report = ANALYZE.analyze("결과가 잘못 되어진다. " + clean_tail, RULES)
        self.assertEqual(report["edit_scope_hint"], "localized")


class VerifyFidelityTests(unittest.TestCase):
    def assert_failed_kind(self, before: str, after: str, kind: str) -> None:
        report = VERIFY.verify(before, after)
        self.assertEqual(report["status"], "fail")
        self.assertIn(kind, {error["kind"] for error in report["errors"]})

    def test_local_edit_preserves_protected_content(self) -> None:
        before = '# 결과\n\n사용자는 10,000명이다. [문서](https://example.com)에서 `user_id`를 확인한다.'
        after = '# 결과\n\n사용자는 10000명이다. [문서](https://example.com)에서 `user_id`를 확인한다.'
        report = VERIFY.verify(before, after)
        self.assertEqual(report["status"], "pass")

    def test_removed_number_fails(self) -> None:
        self.assert_failed_kind("사용자는 42명이다.", "사용자가 있다.", "numbers")

    def test_added_number_fails(self) -> None:
        self.assert_failed_kind("사용자가 있다.", "사용자는 42명이다.", "numbers")

    def test_changed_url_fails(self) -> None:
        self.assert_failed_kind(
            "문서: https://example.com/a",
            "문서: https://example.com/b",
            "urls",
        )

    def test_changed_link_destination_fails(self) -> None:
        self.assert_failed_kind(
            "[문서](https://example.com/a)",
            "[안내](https://example.com/b)",
            "link_destinations",
        )

    def test_changed_inline_code_fails(self) -> None:
        self.assert_failed_kind("`user_id`를 쓴다.", "`member_id`를 쓴다.", "inline_code")

    def test_changed_fenced_code_fails(self) -> None:
        before = "```python\nvalue = 1\n```"
        after = "```python\nvalue = 2\n```"
        self.assert_failed_kind(before, after, "fenced_code")

    def test_changed_direct_quote_fails(self) -> None:
        self.assert_failed_kind('그는 “진행합니다”라고 말했다.', '그는 “중단합니다”라고 말했다.', "direct_quotes")

    def test_heading_level_change_fails(self) -> None:
        self.assert_failed_kind("# 제목\n\n본문", "## 제목\n\n본문", "heading_structure")

    def test_heading_text_change_warns(self) -> None:
        report = VERIFY.verify("# 기존 제목\n\n본문", "# 명확한 제목\n\n본문")
        self.assertEqual(report["status"], "pass")
        self.assertIn("heading_titles", {warning["kind"] for warning in report["warnings"]})

    def test_table_shape_change_fails(self) -> None:
        before = "| 이름 | 값 |\n| --- | --- |\n| A | 1 |"
        after = "| 이름 | 값 | 비고 |\n| --- | --- | --- |\n| A | 1 | ok |"
        self.assert_failed_kind(before, after, "table_structure")

    def test_over_editing_long_document_fails(self) -> None:
        before = "가나다라마바사 아자차카타파하. " * 20
        after = "완전히 다른 문장으로 전체 내용을 교체했다. " * 20
        self.assert_failed_kind(before, after, "over_editing")

    def test_dates_and_versions_tokenize_as_units(self) -> None:
        values = VERIFY.extract_numbers("2026-07-29에 v1.2.3을 배포했다.")
        self.assertIn("date|2026-07-29", values)
        self.assertIn("version|1.2.3", values)

    def test_changed_date_fails(self) -> None:
        self.assert_failed_kind("2026-07-29에 배포한다.", "2026-07-30에 배포한다.", "numbers")

    def test_speech_level_flip_fails(self) -> None:
        self.assert_failed_kind(
            "배포했습니다. 확인하겠습니다. 문제 없습니다.",
            "배포했다. 확인하겠다. 문제 없다.",
            "speech_level",
        )

    def test_same_speech_level_passes(self) -> None:
        report = VERIFY.verify(
            "배포했습니다. 확인하겠습니다. 문제 없습니다.",
            "배포를 마쳤습니다. 다시 확인하겠습니다. 문제 없습니다.",
        )
        self.assertEqual(report["status"], "pass")

    def test_changed_task_state_fails(self) -> None:
        self.assert_failed_kind("- [ ] 배포\n- [x] 검토", "- [x] 배포\n- [x] 검토", "task_states")

    def test_dropped_footnote_fails(self) -> None:
        self.assert_failed_kind("본문이다[^1].\n\n[^1]: 각주", "본문이다.", "footnotes")

    def test_dropped_blockquote_fails(self) -> None:
        self.assert_failed_kind("> 인용문이다.\n\n본문이다.", "본문이다.", "blockquote_structure")

    def test_translated_latin_term_warns(self) -> None:
        report = VERIFY.verify("Kubernetes 위에서 돈다.", "쿠버네티스 위에서 돈다.")
        self.assertIn("latin_terms", {warning["kind"] for warning in report["warnings"]})

    def test_short_rewrite_only_warns_for_change_rate(self) -> None:
        report = VERIFY.verify("짧은 원문입니다.", "문장을 크게 고쳤습니다.")
        self.assertEqual(report["status"], "pass")
        self.assertIn("change_rate", {warning["kind"] for warning in report["warnings"]})


class BuildRulesTests(unittest.TestCase):
    def test_generated_rules_are_current(self) -> None:
        expected = BUILD.render(BUILD.load_rules())
        actual = (SKILL_ROOT / "references" / "runtime-rules.md").read_text(encoding="utf-8")
        self.assertEqual(actual, expected)

    def test_check_cli_succeeds(self) -> None:
        result = subprocess.run(
            [sys.executable, str(SKILL_ROOT / "scripts" / "build_runtime_rules.py"), "--check"],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_check_cli_detects_stale_output(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            stale = Path(temp_dir) / "runtime-rules.md"
            stale.write_text("stale\n", encoding="utf-8")
            result = subprocess.run(
                [
                    sys.executable,
                    str(SKILL_ROOT / "scripts" / "build_runtime_rules.py"),
                    "--check",
                    "--output",
                    str(stale),
                ],
                capture_output=True,
                text=True,
                check=False,
            )
        self.assertEqual(result.returncode, 1)


if __name__ == "__main__":
    unittest.main()
