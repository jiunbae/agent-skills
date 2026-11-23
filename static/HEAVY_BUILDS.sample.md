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
   배터리로 동작 중(`pmset -g batt`)이거나 열 제한이 걸린(`pmset -g therm`) 노트북은 원활해도 받지 않는다.
3. 갈 기기가 없으면 로컬에서 `nice -n 15`로 빌드한다. 로컬이 '과부하'면 10분 뒤 1번부터 다시 판정하고,
   3번 연속 과부하면 빌드하지 않고 사용자에게 알린다.

## 부하 기준

두 가지를 잰다.

- **CPU 사용률**: `top -l 3 -n 0 -s 1`의 user+sys, 1초 간격 샘플 2개 평균(첫 샘플은 부팅 이후 누적이라 버린다).
  원활 판정에 쓴다.
- **부하율** = 1분 load ÷ 유효 코어 × 100. 과부하 확인에만 쓴다. Apple Silicon은 성능이 다른 코어가
  섞여 있어 `hw.ncpu`를 그대로 쓰면 여유가 크게 잡힌다. 유효 코어 = P코어 + E코어/2
  (`hw.perflevel0.physicalcpu` + `hw.perflevel1.physicalcpu`/2)로 친다.
  macOS load는 I/O 대기·멈춘 스레드까지 세어 CPU가 놀아도 수십까지 오를 수 있으므로 load만으로는 판정하지 않는다.

| 기기 종류 | 원활: CPU 사용률 | 과부하(지연): CPU ≥ 95% **이고** 부하율 |
|---|---|---|
| 다른 서비스를 함께 돌리는 서버 | < 50% | ≥ 120% |
| 개인 노트북·데스크톱 | < 70% | ≥ 150% |

공통: 여유 메모리(`memory_pressure -Q`) ≥ 25%여야 원활, < 10%면 CPU와 상관없이 과부하.
둘 사이는 '바쁨'이다. 바쁜 기기는 다른 기기의 빌드를 받지 않는다.

```sh
# 지금 기기의 CPU 사용률, 부하율, 여유 메모리
top -l 3 -n 0 -s 1 | awk '/CPU usage/{n++; if(n>1) t+=$3+$5} END{printf "cpu %d%%\n", t/2}'
p=$(sysctl -n hw.perflevel0.physicalcpu); e=$(sysctl -n hw.perflevel1.physicalcpu 2>/dev/null || echo 0)
sysctl -n vm.loadavg | awk -v c="$p" -v e="$e" '{printf "load %d%%\n", $2/(c+e/2)*100}'
memory_pressure -Q | tail -1
```

## 덧붙임

- 배포용 이미지는 CI가 만든다. 위 판정은 로컬 빌드 확인용이다.
- 빌드는 기기당 한 번에 하나: `pgrep -fl "docker build|xcodebuild|next build|cargo build"`.
- 원격에서 빌드하면 같은 브랜치를 push/pull하거나 `rsync`로 소스를 맞춘다.
- 끝나면 띄운 개발 서버와 부팅한 시뮬레이터를 정리한다(`IOS_SIMULATOR.md`).
