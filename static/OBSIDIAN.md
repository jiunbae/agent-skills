# Obsidian 설정

## Vault 경로
- **경로**: ~/Documents/<VAULT_NAME>

## 문서 설정
- **프론트매터 생성**: true
- **태그 자동 생성**: true
- **기본 태그**: claude, context

## TaskManager 설정
- **활성화**: true
- **자동 링크**: true
- **기본 우선순위**: medium
- **상태 목록**: backlog, in-progress, review, done

## 프로젝트 경로 매핑
`workspace-vibe/` 하위 프로젝트는 `workspace-vibe/{서비스명}/context/` 경로에 저장됩니다.

| 로컬 베이스 경로 | Obsidian 베이스 경로 |
|----------------|---------------------|
| ~/workspace-vibe/* | workspace-vibe/{서비스명}/context |

예시:
- `~/workspace-vibe/colorpal/` → `workspace-vibe/colorpal/context/`
- `~/workspace-vibe/memory-ai/` → `workspace-vibe/memory-ai/context/`
- `~/workspace-vibe/GoalTracker/` → `workspace-vibe/GoalTracker/context/`