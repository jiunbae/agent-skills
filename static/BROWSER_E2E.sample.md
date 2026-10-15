---
access: cli
triggers: ["e2e", "playwright", "puppeteer", "dogfood", "headless", "브라우저 테스트", "driver.mjs", "페르소나 테스트"]
---
# 브라우저 E2E·dogfood 실행 규칙

> 샘플이다. `BROWSER_E2E.md`로 복사해 기기 이름을 자기 환경에 맞게 바꾼다.

**왜 필요한가:** 에이전트가 테스트 회차마다 "브라우저를 띄워 둔 채 끝나지 않는 HTTP driver"를 만들고
이전 것을 끄지 않으면, 캔버스·게임 화면을 headless Chrome이 CPU로 계속 그린다. driver 하나가
CPU 한 코어 이상을 쓰고, 쌓이면 같은 호스트의 다른 서비스(컨테이너 VM 등)가 굶는다.

## 어디서 돌리나

| 기기 | 용도 |
|---|---|
| 여유 있는 개인 기기 | 렌더링이 무거운 브라우저 테스트의 기본 실행 위치 |
| 다른 서비스를 함께 돌리는 서버 | 짧은 단일 테스트만. 장시간·병렬·게임 렌더링 테스트 금지 |
| CI | 반복 실행하는 회귀 테스트 |

어느 기기가 여유 있는지는 `HEAVY_BUILDS.md`의 부하 기준을 따른다.

## 규칙

1. **상주 driver에는 반드시 유휴 자동 종료를 넣는다.** 마지막 요청 후 10분이 지나면 브라우저를
   닫고 프로세스를 끝낸다.
   ```js
   let idle; const IDLE_MS = 10 * 60 * 1000;
   const bump = () => { clearTimeout(idle); idle = setTimeout(async () => {
     for (const c of Object.values(ctx)) await c.close().catch(() => {});
     process.exit(0);
   }, IDLE_MS); };
   bump();  // 요청 핸들러 시작 부분에서도 bump() 호출
   ```
2. **회차·작업이 끝나면 내가 띄운 driver와 브라우저를 직접 끈다.** 새 회차를 시작하기 전에 이전
   회차 driver가 남아 있는지 `pgrep -fl driver.mjs`로 확인한다.
3. **동시에 띄우는 브라우저는 2개까지.** 페르소나가 여럿이면 순서대로 돌린다.
4. **게임·캔버스 페이지는 렌더링을 줄인다.** 테스트 모드에서 프레임 상한을 낮추거나(PixiJS
   `ticker.maxFPS`), 확인이 끝난 페이지는 닫는다. 화면을 띄워 둔 채 기다리지 않는다.
5. **포트 충돌로 listen에 실패한 driver는 즉시 종료한다.** 브라우저만 남아 CPU를 쓴다.

## 자동 정리(선택)

주기적으로 도는 정리기(LaunchAgent, cron)를 두면 안전망이 된다. 예:

- `driver.mjs`: 30분 넘게 산출물이 없거나 10분 넘게 포트를 열지 못하면 브라우저째 종료
- 부모가 사라진 headless Chrome: 10분이 지나면 종료
- 그 밖의 브라우저가 1시간 넘게 평균 CPU 50% 이상: 경고만 남김

정리기에 기대지 말고 위 규칙을 지킨다.
