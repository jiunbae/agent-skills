#!/usr/bin/env python3
"""
에이전트 실행 모듈
Claude와 Codex CLI를 호출하여 기획을 수행합니다.
"""

import asyncio
import os
import subprocess
from typing import Optional

# Anthropic SDK 사용 여부 확인
try:
    import anthropic
    HAS_ANTHROPIC = True
except ImportError:
    HAS_ANTHROPIC = False


async def run_claude_agent(
    prompt: str,
    model: str = "claude-sonnet-4-20250514",
    timeout: int = 120
) -> str:
    """
    Claude API를 호출하여 기획을 수행합니다.

    Args:
        prompt: 기획 프롬프트
        model: Claude 모델명
        timeout: 타임아웃 (초)

    Returns:
        Claude의 응답 텍스트
    """
    api_key = os.environ.get("ANTHROPIC_API_KEY")

    if not api_key:
        return "[오류] ANTHROPIC_API_KEY 환경 변수가 설정되지 않았습니다."

    if not HAS_ANTHROPIC:
        # SDK가 없으면 curl로 직접 호출
        return await _run_claude_via_curl(prompt, model, timeout, api_key)

    try:
        client = anthropic.Anthropic(api_key=api_key)

        # 비동기로 실행하기 위해 to_thread 사용
        def sync_call():
            response = client.messages.create(
                model=model,
                max_tokens=4096,
                messages=[
                    {"role": "user", "content": prompt}
                ]
            )
            return response.content[0].text

        result = await asyncio.wait_for(
            asyncio.to_thread(sync_call),
            timeout=timeout
        )
        return result

    except asyncio.TimeoutError:
        return f"[오류] Claude 응답 타임아웃 ({timeout}초 초과)"
    except Exception as e:
        return f"[오류] Claude API 호출 실패: {str(e)}"


async def _run_claude_via_curl(
    prompt: str,
    model: str,
    timeout: int,
    api_key: str
) -> str:
    """curl을 사용하여 Claude API 호출"""
    import json
    import shlex

    escaped_prompt = prompt.replace('"', '\\"').replace('\n', '\\n')

    payload = {
        "model": model,
        "max_tokens": 4096,
        "messages": [
            {"role": "user", "content": prompt}
        ]
    }

    cmd = [
        "curl", "-s",
        "-X", "POST",
        "https://api.anthropic.com/v1/messages",
        "-H", f"x-api-key: {api_key}",
        "-H", "anthropic-version: 2023-06-01",
        "-H", "content-type: application/json",
        "-d", json.dumps(payload)
    ]

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )

        stdout, stderr = await asyncio.wait_for(
            proc.communicate(),
            timeout=timeout
        )

        if proc.returncode != 0:
            return f"[오류] curl 실패: {stderr.decode()}"

        response = json.loads(stdout.decode())

        if "error" in response:
            return f"[오류] API 오류: {response['error']['message']}"

        return response["content"][0]["text"]

    except asyncio.TimeoutError:
        return f"[오류] Claude 응답 타임아웃 ({timeout}초 초과)"
    except json.JSONDecodeError as e:
        return f"[오류] 응답 파싱 실패: {str(e)}"
    except Exception as e:
        return f"[오류] 요청 실패: {str(e)}"


async def run_codex_agent(
    prompt: str,
    timeout: int = 120
) -> str:
    """
    OpenAI Codex CLI를 호출하여 기획을 수행합니다.

    Args:
        prompt: 기획 프롬프트
        timeout: 타임아웃 (초)

    Returns:
        Codex의 응답 텍스트
    """
    # Codex CLI 설치 확인
    check_cmd = ["which", "codex"]
    check_proc = await asyncio.create_subprocess_exec(
        *check_cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE
    )
    await check_proc.communicate()

    if check_proc.returncode != 0:
        return "[오류] Codex CLI가 설치되어 있지 않습니다. 'npm install -g @openai/codex'로 설치하세요."

    # OpenAI API 키 확인
    if not os.environ.get("OPENAI_API_KEY"):
        return "[오류] OPENAI_API_KEY 환경 변수가 설정되지 않았습니다."

    # Codex CLI 호출
    # exec: 비대화형 실행 모드
    cmd = [
        "codex",
        "exec",
        prompt
    ]

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env={**os.environ}
        )

        stdout, stderr = await asyncio.wait_for(
            proc.communicate(),
            timeout=timeout
        )

        output = stdout.decode().strip()

        if proc.returncode != 0:
            error = stderr.decode().strip()
            if error:
                return f"[오류] Codex 실행 실패: {error}"
            elif not output:
                return "[오류] Codex에서 응답을 받지 못했습니다."

        return output if output else "[응답 없음]"

    except asyncio.TimeoutError:
        # 프로세스 종료 시도
        try:
            proc.terminate()
            await asyncio.sleep(1)
            proc.kill()
        except:
            pass
        return f"[오류] Codex 응답 타임아웃 ({timeout}초 초과)"
    except FileNotFoundError:
        return "[오류] Codex CLI를 찾을 수 없습니다. PATH를 확인하세요."
    except Exception as e:
        return f"[오류] Codex 실행 실패: {str(e)}"


async def run_agent(
    agent_type: str,
    prompt: str,
    model: Optional[str] = None,
    timeout: int = 120
) -> str:
    """
    에이전트 타입에 따라 적절한 실행 함수를 호출합니다.

    Args:
        agent_type: "claude" 또는 "codex"
        prompt: 기획 프롬프트
        model: 모델명 (없으면 기본값 사용)
        timeout: 타임아웃 (초)

    Returns:
        에이전트의 응답 텍스트
    """
    if agent_type == "claude":
        model = model or "claude-sonnet-4-20250514"
        return await run_claude_agent(prompt, model, timeout)
    elif agent_type == "codex":
        return await run_codex_agent(prompt, timeout)
    else:
        return f"[오류] 알 수 없는 에이전트 타입: {agent_type}"
