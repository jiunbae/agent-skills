#!/usr/bin/env python3
"""
Find relevant context documents based on keywords, file paths, and task types.
Uses a weighted scoring system to rank context documents by relevance.
"""

import argparse
import json
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Tuple


class ContextFinder:
    """Discovers relevant context documents using weighted scoring."""

    # Scoring weights
    KEYWORD_WEIGHT = 0.4
    PATH_WEIGHT = 0.3
    TASK_TYPE_WEIGHT = 0.2
    RECENCY_WEIGHT = 0.1

    # Task type to category mapping
    TASK_CATEGORIES = {
        'implementation': ['planning', 'architecture', 'reference'],
        'bugfix': ['operations', 'troubleshooting', 'reference'],
        'setup': ['guides', 'reference', 'operations'],
        'planning': ['planning', 'architecture', 'vision'],
        'documentation': ['guides', 'reference', 'planning'],
        'integration': ['integrations', 'reference', 'guides'],
        'monitoring': ['monitoring', 'operations', 'reference'],
        'security': ['security', 'operations', 'reference'],
    }

    def __init__(self, context_dir: str):
        self.context_dir = Path(context_dir)
        if not self.context_dir.exists():
            raise ValueError(f"Context directory not found: {context_dir}")

    def find_markdown_files(self) -> List[Path]:
        """Find all markdown files in context directory."""
        return list(self.context_dir.rglob("*.md"))

    def score_keyword_match(self, file_path: Path, keywords: List[str]) -> float:
        """Score based on keyword matching in filename and category."""
        if not keywords:
            return 0.0

        score = 0.0
        filename = file_path.stem.lower()
        category = file_path.parent.name.lower()

        for keyword in keywords:
            keyword_lower = keyword.lower()

            # Exact match in filename
            if keyword_lower in filename:
                score += 0.4

            # Match in category name
            if keyword_lower in category:
                score += 0.3

            # Partial match (word boundary)
            if re.search(rf'\b{re.escape(keyword_lower)}', filename):
                score += 0.2

        # Normalize by number of keywords
        return min(score / len(keywords), 1.0)

    def score_path_match(self, file_path: Path, file_paths: List[str]) -> float:
        """Score based on file path overlap."""
        if not file_paths:
            return 0.0

        score = 0.0
        category = file_path.parent.name.lower()

        for path in file_paths:
            path_lower = path.lower()
            path_parts = Path(path).parts

            # Check if any part of the code file path matches category
            for part in path_parts:
                if part.lower() == category or category in part.lower():
                    score += 0.5
                elif part.lower() in category:
                    score += 0.3

        return min(score / len(file_paths) if file_paths else 0, 1.0)

    def score_task_type(self, file_path: Path, task_type: str) -> float:
        """Score based on task type to category mapping."""
        if not task_type:
            return 0.0

        category = file_path.parent.name.lower()
        relevant_categories = self.TASK_CATEGORIES.get(task_type.lower(), [])

        if category in relevant_categories:
            # Higher score for higher priority categories
            priority = relevant_categories.index(category)
            return 1.0 - (priority * 0.2)

        return 0.0

    def score_recency(self, file_path: Path) -> float:
        """Score based on file modification time."""
        try:
            mtime = file_path.stat().st_mtime
            now = datetime.now().timestamp()
            days_old = (now - mtime) / 86400  # Convert to days

            # Files modified in last 7 days get full score
            # Linearly decrease to 0 over 90 days
            if days_old <= 7:
                return 1.0
            elif days_old >= 90:
                return 0.0
            else:
                return 1.0 - ((days_old - 7) / 83)
        except Exception:
            return 0.0

    def calculate_score(
        self,
        file_path: Path,
        keywords: List[str],
        file_paths: List[str],
        task_type: str
    ) -> float:
        """Calculate weighted relevance score for a context document."""
        keyword_score = self.score_keyword_match(file_path, keywords)
        path_score = self.score_path_match(file_path, file_paths)
        task_score = self.score_task_type(file_path, task_type)
        recency_score = self.score_recency(file_path)

        total_score = (
            keyword_score * self.KEYWORD_WEIGHT +
            path_score * self.PATH_WEIGHT +
            task_score * self.TASK_TYPE_WEIGHT +
            recency_score * self.RECENCY_WEIGHT
        )

        return total_score

    def find_relevant_contexts(
        self,
        keywords: List[str] = None,
        file_paths: List[str] = None,
        task_type: str = None,
        max_results: int = 5,
        min_score: float = 0.1
    ) -> List[Dict]:
        """Find and rank relevant context documents."""
        keywords = keywords or []
        file_paths = file_paths or []

        md_files = self.find_markdown_files()
        scored_files = []

        for file_path in md_files:
            # Always include README.md with bonus score
            is_readme = file_path.name.lower() == 'readme.md'

            score = self.calculate_score(file_path, keywords, file_paths, task_type)

            if is_readme:
                score = max(score, 0.7)  # Ensure README gets loaded

            if score >= min_score:
                scored_files.append({
                    'file': str(file_path.relative_to(self.context_dir.parent)),
                    'category': file_path.parent.name,
                    'score': round(score, 3)
                })

        # Sort by score descending
        scored_files.sort(key=lambda x: x['score'], reverse=True)

        return scored_files[:max_results]


def main():
    parser = argparse.ArgumentParser(
        description='Find relevant context documents based on task parameters'
    )
    parser.add_argument(
        '--context-dir',
        required=True,
        help='Path to context directory'
    )
    parser.add_argument(
        '--keywords',
        nargs='*',
        default=[],
        help='Keywords to match against'
    )
    parser.add_argument(
        '--files',
        nargs='*',
        default=[],
        help='File paths being worked on'
    )
    parser.add_argument(
        '--task-type',
        choices=['implementation', 'bugfix', 'setup', 'planning', 'documentation',
                 'integration', 'monitoring', 'security'],
        help='Type of task being performed'
    )
    parser.add_argument(
        '--max-results',
        type=int,
        default=5,
        help='Maximum number of results to return'
    )
    parser.add_argument(
        '--min-score',
        type=float,
        default=0.1,
        help='Minimum relevance score threshold'
    )
    parser.add_argument(
        '--json',
        action='store_true',
        help='Output as JSON'
    )

    args = parser.parse_args()

    try:
        finder = ContextFinder(args.context_dir)
        results = finder.find_relevant_contexts(
            keywords=args.keywords,
            file_paths=args.files,
            task_type=args.task_type,
            max_results=args.max_results,
            min_score=args.min_score
        )

        if args.json:
            print(json.dumps({
                'relevant_files': [r['file'] for r in results],
                'details': results
            }, indent=2))
        else:
            print(f"Found {len(results)} relevant context documents:\n")
            for i, result in enumerate(results, 1):
                print(f"{i}. {result['file']}")
                print(f"   Category: {result['category']}")
                print(f"   Score: {result['score']}")
                print()

    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    import sys
    main()
