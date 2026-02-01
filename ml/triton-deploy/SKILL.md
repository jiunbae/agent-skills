---
name: deploying-triton
description: Deploys and manages NVIDIA Triton Inference Server containers. Automates model repository setup, config generation, and health checks. Use for "triton 서버", "triton 실행", "모델 서빙", "inference server" requests.
---

# Triton Deployment

NVIDIA Triton Inference Server management.

## Quick Start

```bash
# Pull Triton image
docker pull nvcr.io/nvidia/tritonserver:24.01-py3

# Run server
docker run --gpus all -p 8000:8000 -p 8001:8001 -p 8002:8002 \
  -v $(pwd)/models:/models \
  nvcr.io/nvidia/tritonserver:24.01-py3 \
  tritonserver --model-repository=/models
```

## Model Repository Structure

```
models/
└── my_model/
    ├── config.pbtxt
    └── 1/
        └── model.onnx
```

## Config Template

```protobuf
# config.pbtxt
name: "my_model"
platform: "onnxruntime_onnx"
max_batch_size: 8
input [
  { name: "input", data_type: TYPE_FP32, dims: [3, 224, 224] }
]
output [
  { name: "output", data_type: TYPE_FP32, dims: [1000] }
]
```

## Health Check

```bash
# Ready check
curl localhost:8000/v2/health/ready

# Model status
curl localhost:8000/v2/models/my_model
```

## Inference

```bash
# HTTP
curl -X POST localhost:8000/v2/models/my_model/infer \
  -H "Content-Type: application/json" \
  -d '{"inputs": [{"name": "input", "shape": [1,3,224,224], "datatype": "FP32", "data": [...]}]}'

# gRPC
grpcurl -d '...' localhost:8001 inference.GRPCInferenceService/ModelInfer
```

## Best Practices

- Use dynamic batching for throughput
- Enable model warmup
- Monitor with Prometheus metrics (:8002)
- Use model versioning (1/, 2/, etc.)
