# Obsidian 리소스 목록

## Vault 설정

- **Vault 경로**: ~/<VAULT_NAME>
- **프론트매터 생성**: true
- **태그 자동 생성**: true

## 프로젝트 경로 매핑

| 로컬 경로 | Obsidian 경로 |
|----------|--------------|
| `~/workspace/{project}/` | `workspace/{project}/context/` |
| `~/workspace-vibe/{service}/` | `workspace-vibe/{service}/context/` |

## 프로젝트
- [Vibe 10개 앱 생태계](../../../../vibe/README.md)
- [MeetMate - AI 회의 요약](../../../../meetmate/README.md)
- [SleepSense - AI 수면 분석](../../../../sleepsense/README.md)
- [QuickBite Games - 미니 게임](../../../../quickbite-games/README.md)
- [FreelanceHub - 프리랜서 플랫폼](../../../../freelancehub/README.md)
- [MicroInvest - 소액 자동 투자](../../../../microinvest/README.md)
- [VibeSharedServices](../../../../vibe/VibeSharedServices/README.md)
- [Twee - Twitter 아카이브 분석](../../../../<VAULT_NAME>/workspace/twee/planning.md)

## 기획서
- [MeetMate 기획서](../../../../meetmate/PLANNING.md)
- [SleepSense 기획서](../../../../sleepsense/PLANNING.md)
- [QuickBite Games 기획서](../../../../quickbite-games/PLANNING.md)
- [FreelanceHub 기획서](../../../../freelancehub/PLANNING.md)
- [MicroInvest 기획서](../../../../microinvest/PLANNING.md)
- [Twee 기획서](../../../../<VAULT_NAME>/workspace/twee/planning.md)

## 구현 문서
- [5개 앱 완전 구현 완료 보고서](../../../../5_NEW_APPS_FULL_IMPLEMENTATION_COMPLETE.md)
- [작업 프로세스 문서](../../../../task-process.md)

## 코어 구현 파일

### MeetMate (React Native)
- `meetmate/src/types/meeting.types.ts` - 회의, 참여자, 요약, 액션 아이템 타입
- `meetmate/src/services/meetingService.ts` - 회의 CRUD, 시작/중지
- `meetmate/src/services/summaryService.ts` - 요약 생성/가져오기, Q&A 포맷
- `meetmate/src/services/actionItemService.ts` - 액션 아이템 CRUD, 우선순위
- `meetmate/src/store/meetingSlice.ts` - Redux Toolkit 상태 관리
- `meetmate/src/store/userSlice.ts` - 사용자 상태 관리
- `meetmate/src/store/index.ts` - 스토어 설정
- `meetmate/src/screens/HomeScreen.tsx` - 홈 화면, 회의 녹음 시작/중지
- `meetmate/src/screens/RecordingScreen.tsx` - 녹음 화면, 오디오 캡쳐, 녹음 중지
- `meetmate/src/screens/MeetingListScreen.tsx` - 회의 목록 화면
- `meetmate/package.json` - 의존성, 스크립트
- `meetmate/tsconfig.json` - TypeScript 설정
- `meetmate/App.tsx` - 네비게이션 설정

### SleepSense (Swift)
- `sleepsense/SleepSense/Models/SleepData.swift` - 수면 데이터 모델, 단계 분류
- `sleepsense/SleepSense/Models/SleepScore.swift` - 수면 점수, 등급
- `sleepsense/SleepSense/Services/HealthKitService.swift` - HealthKit 통합, 권한 요청, 데이터 수집
- `sleepsense/SleepSense/Services/SleepAnalysisService.swift` - 수면 점수 계산 로직 (시간, 단계, HRV, 일관성)
- `sleepsense/SleepSense/SleepSenseApp.swift` - SwiftUI 앱 진입점, 대시보드

### QuickBite Games (Flutter)
- `quickbite-games/lib/models/game.dart` - 게임 데이터 모델, 점수, 상점
- `quickbite-games/lib/models/shopItem.dart` - 상점 아이템, 가격, 구매 여부
- `quickbite-games/lib/models/dailyChallenge.dart` - 일일 챌린지, 목표 점수, 참여자
- `quickbite-games/lib/games/puzzle_2048.dart` - 2048 게임 로직 (이동, 병합, 셔)
- `quickbite-games/pubspec.yaml` - Flutter 의존성

### FreelanceHub (Next.js)
- `freelancehub/src/types/freelancer.types.ts` - 프리랜서, 포트폴리오, 프로젝트, 이스케이프
- `freelancehub/package.json` - Next.js, TypeScript, Socket.IO, Stripe
- `freelancehub/src/app/layout.tsx` - 루트 레이아웃
- `freelancehub/src/app/page.tsx` - 대시보드, 프로젝트/프리랜서 통계, 수익

### MicroInvest (React Native)
- `microinvest/src/types/investment.types.ts` - 사용자, 포트폴리오, 리스크 프로필, 투자, 트랜잭션
- `microinvest/package.json` - React Native, Expo, Redux, 네비게이션

## AI/ML 통합
- **OpenAI Whisper**: 음성-텍스트 변환 (MeetMate)
- **OpenAI GPT-4**: 회의 요약, 액션 아이템 추출 (MeetMate)
- **Core ML**: 수면 패턴 인식 (SleepSense)

## 기술 스택 요약
- **React Native**: TypeScript, Redux Toolkit, Expo
- **Swift**: SwiftUI, Core ML, HealthKit
- **Flutter**: Dart, Flame 엔진
- **Next.js**: TypeScript, Socket.IO, Prisma

## API 및 통합
- **Supabase**: 인증, 데이터베이스, 파일 스토리지
- **Stripe**: 결제 처리 (FreelanceHub, MicroInvest)
- **Plaid**: 계좌 연동 (MicroInvest)
- **Alphabet**: 한국 계좌 연동 (MicroInvest)

## 수익 모델
- **구독 (SaaS)**: MeetMate
- **프리템 + 유료**: SleepSense, MicroInvest
- **광고 + IAP**: QuickBite Games
- **트랜잭션 수수료**: FreelanceHub

