<p align="center">
  <br>
  <img src="assets/banner.png" alt="agent-skills — AI 코딩 에이전트를 위한 스킬, 페르소나, 훅" width="720">
  <br><br>
  <a href="https://github.com/jiunbae/agent-skills/stargazers"><img src="https://img.shields.io/github/stars/jiunbae/agent-skills?style=for-the-badge&color=ff6b6b&labelColor=1a1a2e" alt="Stars"></a>
  <a href="https://github.com/open330/agt/releases"><img src="https://img.shields.io/github/v/release/open330/agt?style=for-the-badge&color=feca57&labelColor=1a1a2e&label=agt" alt="agt Release"></a>
  <a href="https://www.npmjs.com/package/@open330/agt"><img src="https://img.shields.io/npm/v/@open330/agt?style=for-the-badge&color=c0392b&labelColor=1a1a2e&logo=npm&logoColor=white" alt="npm"></a>
  <a href="#라이선스"><img src="https://img.shields.io/badge/license-MIT-54a0ff?style=for-the-badge&labelColor=1a1a2e" alt="License"></a>
  <img src="https://img.shields.io/badge/skills-30-ee5a24?style=for-the-badge&labelColor=1a1a2e" alt="Skills">
  <img src="https://img.shields.io/badge/personas-7-78e08f?style=for-the-badge&labelColor=1a1a2e" alt="Personas">
  <br><br>
  <a href="#스킬-카탈로그">스킬</a> •
  <a href="#페르소나">페르소나</a> •
  <a href="#훅">훅</a> •
  <a href="#설치">설치</a> •
  <a href="#기여하기">기여하기</a>
  <br>
  <b><a href="README.md">English</a></b>
</p>

---

## 이 레포는?

**Claude Code**, **Codex CLI**, **Gemini CLI** 등 AI 코딩 에이전트를 위한 **스킬**, **페르소나**, **훅** 모음입니다. 각 스킬은 에이전트에게 도메인 전문 능력을 부여하는 독립형 마크다운 모듈입니다.

> **CLI 도구:** **[agt](https://github.com/open330/agt)**로 스킬을 설치/관리하세요 — `npm install -g @open330/agt`

이 저장소가 스킬 콘텐츠의 단일 원본입니다. Rust CLI, npm 패키지와
플랫폼 릴리스는 `Open330/agt`에서만 관리합니다.

---

## 빠른 시작

```bash
# Claude Code용 Core 스킬 설치
npx @open330/agt skill install --profile core --from jiunbae/agent-skills

# Codex용 Core 스킬 설치
npx @open330/agt skill install --profile core --from jiunbae/agent-skills --agent codex

# 설치 확인
npx @open330/agt skill list
npx @open330/agt skill list --agent codex

# 또는 install.sh 직접 사용
git clone https://github.com/jiunbae/agent-skills ~/.agent-skills
cd ~/.agent-skills && ./install.sh --core
```

---

## 설치

### agt CLI로 설치 (Claude Code + Codex)

```bash
npm install -g @open330/agt
agt skill install --profile core --from jiunbae/agent-skills
agt skill install --profile core --from jiunbae/agent-skills --agent codex
agt skill install -g --from jiunbae/agent-skills/development/git-commit-pr
agt persona install -g --from jiunbae/agent-skills
```

`--agent claude`가 기본값이며 `.claude/skills`를 사용합니다.
`--agent codex`는 Codex의 평면형 `.agents/skills/<skill>` 발견 구조를
사용합니다. `--global`을 추가하면 사용자 전역 경로에 설치합니다.

### install.sh로 설치 (Claude Code + Codex)

```bash
git clone https://github.com/jiunbae/agent-skills ~/.agent-skills
cd ~/.agent-skills

./install.sh --core                    # Core 스킬만
./install.sh --core --codex            # Core 스킬 + Codex 사용자 스킬 링크
./install.sh --core --hooks            # Core + 훅
./install.sh all --link-static --codex # 전체 설치
./install.sh --list                    # 옵션 목록
```

### 설치 옵션

| 옵션 | 설명 |
|------|------|
| `--core` | Core 스킬만 전역 설치 (권장) |
| `--cli` | 정식 `@open330/agt` CLI와 레거시 호환 명령 설치 |
| `--link-static` | `~/.agents/skills`를 보존하며 `static/*` 항목을 `~/.agents` 아래에 개별 링크 |
| `--codex` | Codex 시스템 스킬을 보존하며 선택한 스킬을 `~/.agents/skills`에 개별 링크 (`static/*` 항목도 `~/.agents` 아래에 함께 링크) |
| `--hooks` | Claude Code 훅 설치 |
| `--personas` | 에이전트 페르소나 설치 |
| `--copy` | 심링크 대신 복사 |
| `--dry-run` | 미리보기만 |
| `--uninstall` | 설치된 스킬 제거 |

### Core 스킬

`--core` 옵션으로 기본 설치:

- `development/git-commit-pr` — Git 커밋 및 PR 가이드
- `context/context-manager` — 프로젝트 컨텍스트 자동 로드
- `context/static-index` — 글로벌 정적 컨텍스트 인덱스
- `security/security-auditor` — 레포지토리 보안 감사
- `agents/background-implementer` — 격리된 병렬 구현 + 통합 전 검증
- `agents/background-planner` — 페르소나 병렬 기획 + stance 기반 종합
- `agents/background-reviewer` — 페르소나 병렬 리뷰 + 적대적 검증
- `agents/rpf` — Pointer 기반 반복 리뷰·계획·작업·피드백

---

## 스킬 카탈로그

### 🤖 agents/ — AI 에이전트

| 스킬 | 설명 |
|------|------|
| `background-implementer` | 격리된(worktree) 병렬 구현 + 통합 전 검증 게이트 |
| `background-planner` | 페르소나 기반 병렬 기획 + stance 기반 종합(충돌·오픈 이슈 명시) |
| `background-reviewer` | 페르소나 병렬 리뷰 + 적대적 검증 + root-cause 병합 |
| `incident-writer` | 구조화된 장애 및 상태 페이지 보고서 작성 |
| `rpf` | 하나의 동적 pointer 문서를 따르는 다중 에이전트 리뷰·계획·작업·피드백 루프 |

### 🛠 development/ — 개발 도구

| 스킬 | 설명 |
|------|------|
| `appstore-screenshots` | App Store 스크린샷 캡처·업로드 및 ASC 인증 조회 |
| `context-worktree` | 작업별 git worktree 자동 생성 |
| `git-commit-pr` | Git 커밋 및 PR 생성 가이드 |
| `grill-me` | 구현 전 계획을 반대 관점에서 검증 |
| `iac-deploy-prep` | IaC 배포 준비 (K8s, Dockerfile, CI/CD) |
| `playwright` | Playwright 브라우저 자동화 |

### 📊 business/ — 비즈니스

| 스킬 | 설명 |
|------|------|
| `bm-analyzer` | 비즈니스 모델 분석 및 수익화 전략 |
| `proposal-analyzer` | 사업 제안서/RFP 분석 |

### 🔗 integrations/ — 외부 연동

| 스킬 | 설명 |
|------|------|
| `discord-skill` | Discord REST API |
| `kubernetes-skill` | Kubernetes 클러스터 관리 |
| `notion-summary` | Notion 페이지 업로드 |
| `obsidian-tasks` | Obsidian TaskManager (Kanban, Dataview) |
| `obsidian-writer` | Obsidian Vault 저장 및 docs.jiun.dev 퍼블리시 |
| `service-manager` | Docker 컨테이너 및 서비스 중앙 관리 |
| `slack-skill` | Slack 앱 개발 및 API |
| `vault-secrets` | Vaultwarden 자격증명 및 API 키 관리 |

### 🧠 ml/ — ML/AI

| 스킬 | 설명 |
|------|------|
| `audio-processor` | ffmpeg 기반 오디오 처리 |
| `ml-benchmark` | ML 모델 벤치마크 |
| `model-sync` | 모델 파일 서버 동기화 |
| `triton-deploy` | Triton Inference Server 배포 |

### 🔐 security/ — 보안

| 스킬 | 설명 |
|------|------|
| `security-auditor` | 레포지토리 보안 감사 |

### 📁 context/ — 컨텍스트 관리

| 스킬 | 설명 |
|------|------|
| `context-manager` | 프로젝트 컨텍스트 자동 로드 |
| `static-index` | 글로벌 정적 컨텍스트 인덱스 (사용자 프로필 포함) |

### 🔧 meta/ — 메타 스킬

| 스킬 | 설명 |
|------|------|
| `skill-manager` | 스킬 생태계 관리 |

### ✍️ common/ — 글쓰기

| 스킬 | 설명 |
|------|------|
| `korean-editor` | 의미와 형식을 보존하는 한국어 퇴고 및 충실도 검증 |

---

## 페르소나

전문가 아이덴티티를 정의한 마크다운 파일 — 어떤 AI 에이전트에서든 사용 가능.

| 페르소나 | 역할 | 도메인 |
|----------|------|--------|
| `security-reviewer` | Senior AppSec Engineer | OWASP, 인증, 인젝션 |
| `architecture-reviewer` | Principal Architect | SOLID, API 설계, 결합도 |
| `code-quality-reviewer` | Staff Engineer | 가독성, 복잡도, DRY |
| `performance-reviewer` | Performance Engineer | 메모리, CPU, I/O, 확장성 |
| `database-reviewer` | Senior DBA | 쿼리 최적화, 스키마, 인덱싱 |
| `frontend-reviewer` | Senior Frontend Engineer | React, 접근성, 성능 |
| `devops-reviewer` | Senior DevOps/SRE | K8s, IaC, CI/CD |

> 위는 대표 일부입니다. **Planning 페르소나**(`type: planning`) — `technical-planner`, `product-planner`, `delivery-risk-planner` — 는 `background-planner`에서 사용합니다. 전체 목록: [`personas/README.md`](personas/README.md).

### agt CLI로 사용

```bash
agt persona review security-reviewer --codex
agt persona review security-reviewer --codex "이 아키텍처 확장 가능할까?"
agt persona install -g --all
agt persona show security-reviewer
```

### 직접 사용

페르소나는 단순한 `.md` 파일입니다. 파일을 읽을 수 있는 에이전트라면 누구든 채택 가능:

```bash
cat personas/security-reviewer.md | codex -q "이 코드 리뷰해줘"
```

```
.agents/personas/security-reviewer.md    ← 프로젝트 로컬 (최우선)
~/.agents/personas/security-reviewer.md  ← 사용자 전역
personas/security-reviewer.md            ← 라이브러리 (번들)
```

---

## 훅

Claude Code 이벤트 기반 자동화.

```bash
./install.sh --hooks
```

| 훅 | 이벤트 | 설명 |
|----|--------|------|
| `english-coach` | `UserPromptSubmit` | 프롬프트를 자연스러운 영어로 재작성 + 어휘 학습 |
| `prompt-logger` | `UserPromptSubmit` | MinIO로 프롬프트 로깅 (분석용) |

---

## 스킬 만들기

```
group/my-skill/
├── SKILL.md           # 필수: 스킬 정의
├── scripts/           # 선택: 실행 스크립트
├── references/        # 선택: 참고 문서
└── templates/         # 선택: 템플릿 파일
```

```bash
mkdir -p development/my-skill
vim development/my-skill/SKILL.md
agt skill install my-skill          # 테스트 설치
agt skill list | grep my-skill      # 확인
```

---

## 페르소나 만들기

```bash
agt persona create my-reviewer                       # 빈 템플릿
agt persona create rust-expert --ai "Rust unsafe specialist"  # LLM으로 자동 생성
```

---

## 아키텍처

```
agent-skills/ (이 레포)              open330/agt (CLI 도구)
├── agents/       AI 에이전트 스킬   ├── agt/     Rust CLI
├── development/  개발 도구 스킬     ├── npm/     npm 배포
├── business/     비즈니스 스킬      ├── setup.sh 설치 스크립트
├── integrations/ 외부 연동 스킬     └── assets/  브랜딩
├── ml/           ML/AI 스킬
├── security/     보안 스킬
├── context/      컨텍스트 관리
├── meta/         메타 스킬
├── personas/     전문가 페르소나
├── hooks/        Claude Code 훅
├── static/       글로벌 컨텍스트
├── install.sh    로컬 설치
└── codex-support/ Codex CLI 지원
```

---

## 기여하기

1. **스킬 추가** — 적절한 카테고리에 새 스킬 생성
2. **페르소나 추가** — 도메인 전문가 페르소나 생성
3. **문서 개선** — 오타 수정, 예제 추가, 번역
4. **이슈 제보** — 버그 리포트 및 기능 요청 환영

```bash
git clone https://github.com/jiunbae/agent-skills ~/.agent-skills
cd ~/.agent-skills
./install.sh --core
```

CLI 도구 기여는 [open330/agt](https://github.com/open330/agt)를 참고하세요.

---

## 라이선스

MIT License.

---

<p align="center">
  <sub><strong>30</strong> 스킬 | <strong>7</strong> 페르소나 | <strong>2</strong> 훅</sub><br>
  <sub>CLI 도구: <a href="https://github.com/open330/agt">open330/agt</a></sub>
</p>
