#!/bin/bash
#
# security-patterns.sh - 민감 정보 패턴 정의
#
# 이 파일은 보안 검사에 사용되는 패턴을 정의합니다.
#

# 민감 정보 패턴 (정규식|설명|심각도)
PATTERNS=(
    # CRITICAL - 즉시 조치 필요
    "sk-[a-zA-Z0-9]{20,}|OpenAI API Key|CRITICAL"
    "AKIA[A-Z0-9]{16}|AWS Access Key|CRITICAL"
    "ghp_[a-zA-Z0-9]{36}|GitHub Personal Token|CRITICAL"
    "gho_[a-zA-Z0-9]{36}|GitHub OAuth Token|CRITICAL"
    "xoxb-[0-9]{10,}|Slack Bot Token|CRITICAL"
    "xoxp-[0-9]{10,}|Slack User Token|CRITICAL"
    "AIza[0-9A-Za-z_-]{35}|Google API Key|CRITICAL"
    "-----BEGIN (RSA|OPENSSH|EC|DSA|PGP) PRIVATE KEY-----|Private Key|CRITICAL"

    # HIGH - 빠른 조치 필요
    "password\s*[:=]\s*[\"'][^\"']{8,}[\"']|Hardcoded Password|HIGH"
    "api_key\s*[:=]\s*[\"'][^\"']+[\"']|Hardcoded API Key|HIGH"
    "secret\s*[:=]\s*[\"'][^\"']+[\"']|Hardcoded Secret|HIGH"
    "mongodb(\+srv)?://[^:]+:[^@]+@|MongoDB Connection String|HIGH"
    "postgres://[^:]+:[^@]+@|PostgreSQL Connection String|HIGH"
    "mysql://[^:]+:[^@]+@|MySQL Connection String|HIGH"
    "redis://[^:]+:[^@]+@|Redis Connection String|HIGH"
)

# 위험 파일 패턴
DANGEROUS_FILES=(
    "\.env$"
    "\.env\."
    "credentials"
    "secrets?\."
    "\.pem$"
    "\.key$"
    "\.p12$"
    "\.pfx$"
    "id_rsa"
    "id_dsa"
    "id_ecdsa"
    "id_ed25519"
)

# 제외 경로
EXCLUDE_DIRS="node_modules|vendor|\.git|dist|build|__pycache__|venv|\.venv"
EXCLUDE_FILES="test|tests|__tests__|spec|mock|fixture|example"
