---
access: cli
triggers: ["docker build", "buildx", "xcodebuild", "next build", "빌드", "이미지 빌드", "cargo build", "unity batch", "릴리스 빌드"]
---
# 무거운 빌드 실행 위치

> 샘플이다. `HEAVY_BUILDS.md`로 복사해 기기 이름과 임계치를 자기 환경에 맞게 바꾼다.

여러 기기에 SSH로 접속할 수 있을 때 빌드를 어디서 돌릴지 정한다. 상시 연결된 서버(`<server>`)와
연결되지 않았을 수 있는 노트북(`<laptop-a>`, `<laptop-b>`)이 있다고 가정한다.

## 규칙

1. **로컬 원칙**: 지금 기기가 '원활'이면 로컬에서 빌드한다.
2. 로컬이 원활하지 않으면 **접속 가능하고 '원활'한** 다른 기기로 보낸다.
   접속 확인은 `ssh -o ConnectTimeout=5 -o BatchMode=yes <host> true`.
3. 갈 기기가 없으면 로컬에서 `nice -n 15`로 빌드한다. 로컬이 '과부하'면 10분 뒤 1번부터 다시 판정하고,
   3번 연속 과부하면 빌드하지 않고 사용자에게 알린다.

## 부하 기준

**부하율 = 1분 load average ÷ 코어 수(`sysctl -n hw.ncpu`) × 100.**
여유 메모리는 macOS `memory_pressure -Q`의 free percentage.

| 기기 종류 | 원활 | 과부하(지연) |
|---|---|---|
| 다른 서비스를 함께 돌리는 서버 | < 50% | ≥ 120% |
| 개인 노트북·데스크톱 | < 70% | ≥ 150% |

공통: 여유 메모리 ≥ 25%여야 원활, < 10%면 부하율과 상관없이 과부하.
둘 사이는 '바쁨'이다. 바쁜 기기는 다른 기기의 빌드를 받지 않는다.

```sh
# 지금 기기의 부하율과 여유 메모리
echo $(( $(sysctl -n vm.loadavg | awk '{print int($2*100)}') / $(sysctl -n hw.ncpu) ))%
memory_pressure -Q | tail -1
```

## 덧붙임

- 배포용 이미지는 CI가 만든다. 위 판정은 로컬 빌드 확인용이다.
- 빌드는 기기당 한 번에 하나: `pgrep -fl "docker build|xcodebuild|next build|cargo build"`.
- 원격에서 빌드하면 같은 브랜치를 push/pull하거나 `rsync`로 소스를 맞춘다.
- 끝나면 띄운 개발 서버와 부팅한 시뮬레이터를 정리한다(`IOS_SIMULATOR.md`).
