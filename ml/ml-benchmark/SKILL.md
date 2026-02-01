---
name: benchmarking-ml-models
description: Runs ML model benchmarks and evaluations. Measures inference speed, memory usage, and accuracy metrics. Use for "벤치마크", "모델 평가", "성능 테스트", "inference 속도" requests.
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

# Benchmark
start = time.time()
for _ in range(100):
    model(sample_input)
torch.cuda.synchronize()
elapsed = time.time() - start

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

```bash
# Run standard benchmark
python benchmark.py --model ./model.pt --batch-size 32 --iterations 100
```

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
