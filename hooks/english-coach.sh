#!/bin/bash
# English Coaching Hook - runs on every prompt submission
# Rewrites user's prompt in natural English and shows vocabulary

cat <<'INSTRUCTION'
[English Coach] Before responding to the user's task, do the following FIRST:

1. **Improved English**: Rewrite the user's prompt in natural, commonly-used English. Preserve the original intent completely. If the prompt is in Korean, translate it. If already in English, improve it.
2. **Vocabulary**: List any intermediate/advanced English words from the improved version with Korean definitions.

Format:
---
> **Your prompt in better English:**
> (rewritten prompt here)
>
> **Vocabulary:**
> - word1: Korean meaning
> - word2: Korean meaning
---

Then proceed to actually handle the user's request as normal.
INSTRUCTION
