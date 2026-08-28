"""Repository-level Skill identity contract."""

from pathlib import Path
import re
import unittest


REPOSITORY = Path(__file__).resolve().parents[3]
FRONTMATTER_NAME = re.compile(
    r"\A---\r?\n(?P<body>[\s\S]*?)\r?\n---(?:\r?\n|\Z)"
)
NAME_LINE = re.compile(r"^name:[ \t]*(?P<name>\S+)[ \t]*$", re.MULTILINE)


class SkillNameContractTest(unittest.TestCase):
    def test_fixed_depth_skill_names_equal_their_directory_names(self) -> None:
        skills = sorted(REPOSITORY.glob("*/*/SKILL.md"))
        self.assertEqual(30, len(skills))

        mismatches = []
        for skill in skills:
            source = skill.read_text(encoding="utf-8")
            frontmatter = FRONTMATTER_NAME.match(source)
            self.assertIsNotNone(frontmatter, skill.relative_to(REPOSITORY))
            declared = NAME_LINE.search(frontmatter.group("body"))
            self.assertIsNotNone(declared, skill.relative_to(REPOSITORY))
            if declared.group("name") != skill.parent.name:
                mismatches.append(
                    f"{skill.relative_to(REPOSITORY)}: "
                    f"{declared.group('name')} != {skill.parent.name}"
                )

        self.assertEqual([], mismatches)


if __name__ == "__main__":
    unittest.main()
