---
name: ml-benchmark
description: Guides ML model benchmarks and evaluations. Measures inference speed, memory usage, and accuracy metrics. Use for "벤치마크", "모델 평가", "성능 테스트", "inference 속도" requests.
---

# ML Benchmark

Model performance benchmarking.

## Quick Benchmark

```python
import time
import torch

# Warmup
for _ in range(10):
    model(sample_input)

# CUDA calls are asynchronous. Finish warmup before starting the clock.
use_cuda = torch.cuda.is_available()
if use_cuda:
    torch.cuda.synchronize()

# Benchmark
start = time.perf_counter()
for _ in range(100):
    model(sample_input)
if use_cuda:
    torch.cuda.synchronize()
elapsed = time.perf_counter() - start

print(f"Avg latency: {elapsed/100*1000:.2f}ms")
```

## Metrics

| Metric | Description | Command |
|--------|-------------|---------|
| Latency | Inference time | `time.time()` |
| Throughput | Samples/sec | `samples / elapsed` |
| Memory | VRAM usage | `torch.cuda.max_memory_allocated()` |
| Accuracy | Model quality | `accuracy_score(y_true, y_pred)` |

## Benchmark Script

The bundled helper has no inference or dataset adapter. Its `run` and `evaluate`
commands intentionally exit nonzero before printing or saving results. Do not
treat endpoint health, sleeps, or generated labels as model measurements.

```bash
# From this Skill's directory; currently verifies the fail-closed contract.
bash scripts/ml-benchmark.sh run \
  --url localhost:8001 \
  --model langdetector \
  --input ./sample.wav \
  --batch-size 32 \
  --runs 100
```

Before enabling that command, add a real, versioned inference adapter and test
that every recorded sample comes from a completed model response. Accuracy also
requires a dataset adapter that reads ground-truth labels and predictions.

## Output Format

```markdown
## Benchmark Results: {model_name}

| Metric | Value |
|--------|-------|
| Latency (p50) | 15.2ms |
| Latency (p99) | 22.1ms |
| Throughput | 65 samples/sec |
| Memory | 4.2 GB |
| Accuracy | 92.3% |

### Configuration
- GPU: NVIDIA A100
- Batch size: 32
- Precision: FP16
```

## Compare Models

```python
results = {}
for model_name, model in models.items():
    results[model_name] = benchmark(model)

# Generate comparison table
```

## Best Practices

- Always warmup before measuring
- Use `torch.cuda.synchronize()` for GPU
- Report p50/p99 latencies
- Document hardware configuration
