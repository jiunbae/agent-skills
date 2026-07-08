---
name: image-generator
description: Generates images for free using HuggingFace Spaces Gradio API (FLUX model). No API key or authentication required. Use for "이미지 생성", "로고 만들기", "image gen", "generate image", "그림 그려줘" requests.
allowed-tools: Read, Bash, Grep, Glob, Write, Edit, AskUserQuestion
priority: medium
tags: [image-generation, free, flux, huggingface, gradio, no-auth]
---

# Free Image Generator

Generate high-quality images using HuggingFace Spaces Gradio API — completely free, no API key needed.

## Quick Start

```python
from gradio_client import Client
from pathlib import Path

client = Client("ByteDance/Hyper-FLUX-8Steps-LoRA")
result = client.predict(
    height=1024, width=1024,
    steps=8, scales=3.5,
    prompt="your prompt here",
    seed=42,
    api_name="/process_image"
)
# result = filepath to generated image (webp)
```

## Prerequisites

```bash
# Install gradio_client (one-time)
uv pip install --system --break-system-packages gradio_client
```

## Working Spaces (tested 2026-03)

| Space | Model | Status |
|-------|-------|--------|
| `ByteDance/Hyper-FLUX-8Steps-LoRA` | FLUX + LoRA | **Working** |
| `black-forest-labs/FLUX.1-schnell` | FLUX.1 schnell | Often down |
| `stabilityai/stable-diffusion-3.5-large-turbo` | SD 3.5 | Often down |

**Fallback strategy**: If primary space is down, try others or search for community FLUX spaces.

## API Reference

### ByteDance/Hyper-FLUX-8Steps-LoRA

```python
result = client.predict(
    height=1024,        # 256-1152
    width=1024,         # 256-1152
    steps=8,            # 6-25 (8 is good balance)
    scales=3.5,         # 0.0-5.0 (CFG scale)
    prompt="...",       # text prompt
    seed=42,            # seed for reproducibility
    api_name="/process_image"
)
# Returns: filepath (str) to generated webp image
```

## Batch Generation

```python
import shutil
from pathlib import Path
from gradio_client import Client

output_dir = Path("/tmp/generated_images")
output_dir.mkdir(exist_ok=True)

client = Client("ByteDance/Hyper-FLUX-8Steps-LoRA")

prompts = ["prompt 1", "prompt 2", ...]
for i, prompt in enumerate(prompts):
    result = client.predict(
        height=1024, width=1024, steps=8, scales=3.5,
        prompt=prompt, seed=42+i,
        api_name="/process_image"
    )
    dst = output_dir / f"image_{i+1}.webp"
    shutil.copy2(str(result), str(dst))
```

## Notes

- **Free Gemini API image gen is dead** (2026-03): All image models return `limit: 0` on free tier
- **HuggingFace Inference API** requires fine-grained token with inference permission
- **HF Spaces Gradio API** is the most reliable free option — no auth needed
- Output format is typically **webp**
- Rate limits are per-space; spread across multiple spaces if generating many images
- If a space returns `RUNTIME_ERROR`, it's temporarily down — try another space
