#!/usr/bin/env python3
"""
멀티 에이전트 기획 도구
여러 AI 에이전트(Claude, Codex)가 동일 주제에 대해 기획하고 결과를 머지합니다.
"""

import argparse
import asyncio
import json
import os
import random
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional

# 스크립트 디렉토리를 기준으로 모듈 임포트
SCRIPT_DIR = Path(__file__).parent
sys.path.insert(0, str(SCRIPT_DIR))

from agent_runner import run_claude_agent, run_codex_agent
from merger import merge_plans


def parse_args():
    parser = argparse.ArgumentParser(
        description="멀티 에이전트 기획 도구 - Claude와 Codex가 함께 기획합니다"
    )
    parser.add_argument(
        "--topic",
        "-t",
        required=True,
        help="기획 주제 (예: '로그인 기능', '모바일 앱 온보딩')"
    )
    parser.add_argument(
        "--agents",
        "-n",
        type=int,
        default=2,
        help="기획에 참여할 에이전트 수 (기본값: 2)"
    )
    parser.add_argument(
        "--output",
        "-o",
        default="./planning_output",
        help="결과 저장 디렉토리 (기본값: ./planning_output)"
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=120,
        help="각 에이전트 타임아웃 (초, 기본값: 120)"
    )
    parser.add_argument(
        "--claude-model",
        default="claude-sonnet-4-20250514",
        help="Claude API 모델 (기본값: claude-sonnet-4-20250514)"
    )
    parser.add_argument(
        "--no-save",
        action="store_true",
        help="파일 저장 비활성화 (터미널 출력만)"
    )
    return parser.parse_args()


def assign_agents(count: int) -> list[dict]:
    """에이전트 수에 따라 Claude와 Codex를 랜덤 분배"""
    agents = []
    for i in range(count):
        agent_type = random.choice(["claude", "codex"])
        agents.append({
            "id": i + 1,
            "type": agent_type,
            "name": f"Agent {i + 1} ({agent_type.capitalize()})"
        })
    return agents


def get_planning_prompt(topic: str) -> str:
    """기획 프롬프트 생성"""
    return f"""다음 주제에 대해 상세한 기획안을 작성해주세요: {topic}

기획안에는 다음 내용을 포함해주세요:

## 1. 핵심 아이디어 및 목표
- 이 기능/프로젝트의 핵심 목적
- 해결하고자 하는 문제
- 기대 효과

## 2. 주요 기능 및 구성 요소
- 필수 기능 목록
- 각 기능의 상세 설명
- 우선순위 (Must-have / Nice-to-have)

## 3. 구현 접근 방식
- 기술적 접근법
- 아키텍처 개요
- 단계별 구현 계획

## 4. 예상 도전과제 및 해결책
- 기술적 도전과제
- 비기술적 도전과제 (리소스, 일정 등)
- 각 도전과제에 대한 해결 방안

## 5. 성공 지표
- 측정 가능한 KPI
- 성공 기준
- 모니터링 방법

창의적이고 실현 가능한 기획안을 작성해주세요."""


def print_header(topic: str, agents: list[dict]):
    """실행 헤더 출력"""
    claude_count = sum(1 for a in agents if a["type"] == "claude")
    codex_count = sum(1 for a in agents if a["type"] == "codex")

    print("\n" + "=" * 60)
    print("  멀티 에이전트 기획 시작")
    print(f"  주제: {topic}")
    print(f"  에이전트 수: {len(agents)}명")
    print(f"  분배: Claude({claude_count}) / Codex({codex_count})")
    print("=" * 60 + "\n")


def print_agent_result(agent: dict, result: str):
    """개별 에이전트 결과 출력"""
    print(f"\n{'─' * 60}")
    print(f"  {agent['name']}")
    print("─" * 60)
    print(result)


def print_merged_result(merged: str):
    """통합 기획안 출력"""
    print("\n" + "=" * 60)
    print("  통합 기획안")
    print("=" * 60)
    print(merged)


def save_results(
    topic: str,
    agents: list[dict],
    results: list[dict],
    merged: str,
    output_dir: str
):
    """결과를 마크다운 파일로 저장"""
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_topic = "".join(c if c.isalnum() or c in "._- " else "_" for c in topic)
    safe_topic = safe_topic[:50]  # 파일명 길이 제한
    filename = f"{safe_topic}_{timestamp}.md"
    filepath = output_path / filename

    claude_count = sum(1 for a in agents if a["type"] == "claude")
    codex_count = sum(1 for a in agents if a["type"] == "codex")

    content = f"""# 멀티 에이전트 기획: {topic}

- 생성일시: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}
- 에이전트 수: {len(agents)} (Claude: {claude_count}, Codex: {codex_count})

---

"""

    # 개별 에이전트 결과
    for r in results:
        content += f"""## {r['agent']['name']} 기획안

{r['result']}

---

"""

    # 통합 기획안
    content += f"""# 통합 기획안

{merged}
"""

    filepath.write_text(content, encoding="utf-8")
    return filepath


async def run_planning(args):
    """메인 기획 실행 로직"""
    topic = args.topic
    agent_count = args.agents

    # 에이전트 분배
    agents = assign_agents(agent_count)
    print_header(topic, agents)

    # 기획 프롬프트
    prompt = get_planning_prompt(topic)

    # 병렬 실행
    results = []
    tasks = []

    for agent in agents:
        print(f"[{agent['name']}] 기획 중...")

        if agent["type"] == "claude":
            task = run_claude_agent(
                prompt=prompt,
                model=args.claude_model,
                timeout=args.timeout
            )
        else:  # codex
            task = run_codex_agent(
                prompt=prompt,
                timeout=args.timeout
            )
        tasks.append((agent, task))

    # 결과 수집
    for agent, task in tasks:
        try:
            result = await task
            results.append({"agent": agent, "result": result})
            print(f"✓ {agent['name']} 완료")
        except Exception as e:
            error_msg = f"오류 발생: {str(e)}"
            results.append({"agent": agent, "result": error_msg})
            print(f"✗ {agent['name']} 실패: {e}")

    # 개별 결과 출력
    print("\n" + "=" * 60)
    print("  개별 기획안")
    print("=" * 60)

    for r in results:
        print_agent_result(r["agent"], r["result"])

    # 결과 머지
    merged = await merge_plans(
        topic=topic,
        results=results,
        model=args.claude_model
    )
    print_merged_result(merged)

    # 파일 저장
    if not args.no_save:
        filepath = save_results(topic, agents, results, merged, args.output)
        print("\n" + "=" * 60)
        print(f"  결과 저장됨: {filepath}")
        print("=" * 60 + "\n")

    return results, merged


def main():
    args = parse_args()

    # 에이전트 수 검증
    if args.agents < 1:
        print("오류: 에이전트 수는 최소 1명이어야 합니다.")
        sys.exit(1)
    if args.agents > 10:
        print("경고: 에이전트 수가 10명을 초과합니다. 비용과 시간이 많이 소요될 수 있습니다.")

    asyncio.run(run_planning(args))


if __name__ == "__main__":
    main()
