---
access: cli
triggers: ["시뮬레이터", "simulator", "simctl", "iOS 테스트", "XCUITest", "xcodebuild test", "UI 테스트"]
---
# iOS 시뮬레이터 사용 규칙

> 샘플이다. `IOS_SIMULATOR.md`로 복사해 프로젝트별 기기 이름을 정해 넣는다.

시뮬레이터는 만들기는 쉽고 지우는 단계는 아무도 하지 않는다. 하나가 1GB로 시작해
앱 설치와 캐시로 3~4.5GB까지 자라고, 부팅된 채로 두면 메모리도 계속 잡는다.
에이전트가 회차마다 기기를 새로 만들면 기기당 수십 GB가 쌓이고, 부팅한 기기가 몇 주씩 켜져 있게 된다.

## 규칙

1. **회차·작업마다 새 기기를 만들지 않는다.** 프로젝트·기기 종류마다 이름이 고정된 기기
   하나를 재사용한다(예: `myapp-test-iphone`, `myapp-test-se`). 있으면 쓰고, 없을 때만 만든다.
   ```bash
   UDID=$(xcrun simctl list devices -j | jq -r '.devices[][]|select(.name=="myapp-test-iphone")|.udid' | head -1)
   [ -z "$UDID" ] && UDID=$(xcrun simctl create myapp-test-iphone "iPhone 17")
   ```
2. **깨끗한 상태가 필요하면 지우고 새로 만들지 말고 초기화한다.**
   ```bash
   xcrun simctl shutdown "$UDID" 2>/dev/null; xcrun simctl erase "$UDID"
   ```
3. **끝나면 반드시 끈다.** 작업이 끝났는데 기기를 부팅된 채로 두지 않는다.
   ```bash
   xcrun simctl shutdown "$UDID"
   ```
4. **이번 작업에서 임시로 만든 기기는 작업 끝에 지운다.** 만들었다면 UDID를 기록해 두고 삭제한다.
   ```bash
   xcrun simctl delete "$UDID"
   ```
5. **병렬 테스트는 기기를 손으로 복제하지 않는다.** `xcodebuild test -parallel-testing-enabled YES
   -maximum-concurrent-test-simulator-destinations N`은 실행용 복제본을 만들고 끝나면 스스로 지운다.
6. 작업을 마칠 때 `xcrun simctl delete unavailable`로 런타임이 사라진 기기를 정리한다.

## 하지 말 것

- 사람이 이름 붙여 쓰는 기기를 지우거나 erase하지 않는다. 그 안의 앱 데이터는 사람의 것이다.
- 다른 세션이 부팅해 둔 기기를 끄지 않는다. 내가 부팅한 것만 끈다.
