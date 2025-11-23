#!/usr/bin/env python3
"""
Update or create context documents based on completed work.
Handles document merging and maintains consistency.
"""

import argparse
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional


class ContextUpdater:
    """Manages updates to context documentation."""

    COMMON_CATEGORIES = [
        'planning',
        'architecture',
        'guides',
        'operations',
        'reference',
        'integrations',
        'agents',
        'monitoring',
        'security',
        'vision',
        'idea',
    ]

    def __init__(self, context_dir: str):
        self.context_dir = Path(context_dir)
        self.context_dir.mkdir(exist_ok=True)

    def ensure_category_exists(self, category: str) -> Path:
        """Create category directory if it doesn't exist."""
        category_path = self.context_dir / category
        category_path.mkdir(exist_ok=True)
        return category_path

    def find_existing_file(self, category: str, filename: str) -> Optional[Path]:
        """Find existing file in category."""
        category_path = self.context_dir / category
        if not category_path.exists():
            return None

        file_path = category_path / filename
        return file_path if file_path.exists() else None

    def update_document(
        self,
        category: str,
        filename: str,
        summary: str,
        section: Optional[str] = None,
        append: bool = True
    ) -> Path:
        """Update an existing document or create new one."""
        category_path = self.ensure_category_exists(category)
        file_path = category_path / filename

        timestamp = datetime.now().strftime('%Y-%m-%d %H:%M')
        update_content = f"\n\n## Update - {timestamp}\n\n{summary}\n"

        if file_path.exists():
            # Update existing file
            with open(file_path, 'r', encoding='utf-8') as f:
                existing_content = f.read()

            if section:
                # Try to find and update specific section
                updated_content = self._update_section(
                    existing_content,
                    section,
                    summary
                )
            elif append:
                # Append to end
                updated_content = existing_content + update_content
            else:
                # Prepend after title
                updated_content = self._prepend_content(
                    existing_content,
                    update_content
                )

            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(updated_content)

            print(f"✅ Updated: {file_path.relative_to(self.context_dir.parent)}")

        else:
            # Create new file
            content = self._generate_new_document(
                filename,
                category,
                summary
            )

            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(content)

            print(f"✅ Created: {file_path.relative_to(self.context_dir.parent)}")

        return file_path

    def _update_section(
        self,
        content: str,
        section: str,
        new_content: str
    ) -> str:
        """Update a specific section in the document."""
        lines = content.split('\n')
        section_found = False
        section_start = -1
        section_end = -1
        section_level = 0

        # Find the section
        for i, line in enumerate(lines):
            if line.strip().startswith('#'):
                # Count heading level
                level = len(line) - len(line.lstrip('#'))
                heading_text = line.lstrip('#').strip()

                if heading_text.lower() == section.lower():
                    section_found = True
                    section_start = i
                    section_level = level
                elif section_found and level <= section_level:
                    section_end = i
                    break

        if section_found:
            if section_end == -1:
                section_end = len(lines)

            # Replace section content
            timestamp = datetime.now().strftime('%Y-%m-%d %H:%M')
            update_note = f"\n*Updated: {timestamp}*\n\n{new_content}\n"

            new_lines = (
                lines[:section_start + 1] +
                [update_note] +
                lines[section_end:]
            )

            return '\n'.join(new_lines)
        else:
            # Section not found, append
            timestamp = datetime.now().strftime('%Y-%m-%d %H:%M')
            return content + f"\n\n## {section}\n\n*Created: {timestamp}*\n\n{new_content}\n"

    def _prepend_content(self, content: str, new_content: str) -> str:
        """Prepend content after the document title."""
        lines = content.split('\n')

        # Find first heading
        for i, line in enumerate(lines):
            if line.strip().startswith('#'):
                # Insert after title and any metadata
                insert_pos = i + 1
                # Skip empty lines after title
                while insert_pos < len(lines) and not lines[insert_pos].strip():
                    insert_pos += 1

                new_lines = lines[:insert_pos] + [new_content] + lines[insert_pos:]
                return '\n'.join(new_lines)

        # No heading found, just prepend
        return new_content + '\n\n' + content

    def _generate_new_document(
        self,
        filename: str,
        category: str,
        summary: str
    ) -> str:
        """Generate a new context document with standard structure."""
        title = filename.replace('.md', '').replace('_', ' ').replace('-', ' ').title()
        timestamp = datetime.now().strftime('%Y-%m-%d')

        template = f"""# {title}

**Category**: {category}
**Created**: {timestamp}

## Overview

{summary}

## Status

- [ ] In Progress

## Related Documents

- [README](../README.md)

---

*This document is maintained as part of the project context system.*
"""

        return template

    def create_category_index(self, category: str) -> Path:
        """Create or update README.md for a category."""
        category_path = self.ensure_category_exists(category)
        readme_path = category_path / 'README.md'

        # Find all markdown files in category
        md_files = sorted([
            f for f in category_path.glob('*.md')
            if f.name != 'README.md'
        ])

        content = f"""# {category.title()} Documentation

This directory contains {category}-related documentation.

## Documents

"""

        for md_file in md_files:
            title = md_file.stem.replace('_', ' ').replace('-', ' ').title()
            content += f"- [{title}]({md_file.name})\n"

        content += f"""
---

*Last updated: {datetime.now().strftime('%Y-%m-%d')}*
"""

        with open(readme_path, 'w', encoding='utf-8') as f:
            f.write(content)

        print(f"✅ Updated index: {readme_path.relative_to(self.context_dir.parent)}")

        return readme_path


def main():
    parser = argparse.ArgumentParser(
        description='Update or create context documents'
    )
    parser.add_argument(
        '--context-dir',
        required=True,
        help='Path to context directory'
    )
    parser.add_argument(
        '--category',
        required=True,
        help='Category for the document'
    )
    parser.add_argument(
        '--file',
        required=True,
        help='Filename (e.g., implementation_plan.md)'
    )
    parser.add_argument(
        '--action',
        choices=['update', 'create', 'section'],
        default='update',
        help='Action to perform'
    )
    parser.add_argument(
        '--summary',
        required=True,
        help='Summary of changes or content'
    )
    parser.add_argument(
        '--section',
        help='Section name to update (for section action)'
    )
    parser.add_argument(
        '--prepend',
        action='store_true',
        help='Prepend instead of append (for update action)'
    )
    parser.add_argument(
        '--update-index',
        action='store_true',
        help='Update category README.md index'
    )

    args = parser.parse_args()

    # Ensure filename ends with .md
    filename = args.file if args.file.endswith('.md') else f"{args.file}.md"

    try:
        updater = ContextUpdater(args.context_dir)

        if args.action == 'section':
            if not args.section:
                print("Error: --section required for section action", file=sys.stderr)
                sys.exit(1)

            updater.update_document(
                category=args.category,
                filename=filename,
                summary=args.summary,
                section=args.section
            )
        else:
            updater.update_document(
                category=args.category,
                filename=filename,
                summary=args.summary,
                append=not args.prepend
            )

        if args.update_index:
            updater.create_category_index(args.category)

        print("\n✨ Context update complete!")

    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
