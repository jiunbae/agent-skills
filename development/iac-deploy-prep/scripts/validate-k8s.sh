#!/bin/bash
# IaC Deploy Prep - K8s 매니페스트 검증 스크립트
# Usage: ./validate-k8s.sh [k8s_path]

set -euo pipefail

K8S_PATH="${1:-k8s}"

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  K8s 매니페스트 검증${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

ERRORS=0
WARNINGS=0

# 디렉토리 존재 확인
if [[ ! -d "$K8S_PATH" ]]; then
    echo -e "${RED}✗${NC} K8s 디렉토리를 찾을 수 없습니다: $K8S_PATH"
    exit 1
fi

# 1. Kustomize 빌드 테스트
echo -e "${BLUE}[1/5] Kustomize 빌드 테스트...${NC}"
if command -v kustomize &> /dev/null; then
    if kustomize build "${K8S_PATH}/base" > /dev/null 2>&1; then
        echo -e "${GREEN}✓${NC} Kustomize 빌드 성공"
    else
        echo -e "${RED}✗${NC} Kustomize 빌드 실패"
        ERRORS=$((ERRORS + 1))
    fi
else
    echo -e "${YELLOW}⚠${NC} kustomize 명령어 없음 - kubectl kustomize 사용"
    if kubectl kustomize "${K8S_PATH}/base" > /dev/null 2>&1; then
        echo -e "${GREEN}✓${NC} kubectl kustomize 빌드 성공"
    else
        echo -e "${RED}✗${NC} kubectl kustomize 빌드 실패"
        ERRORS=$((ERRORS + 1))
    fi
fi

# 2. 필수 파일 확인
echo -e "${BLUE}[2/5] 필수 파일 확인...${NC}"
REQUIRED_FILES=(
    "base/kustomization.yaml"
    "base/deployment.yaml"
    "base/service.yaml"
)

for file in "${REQUIRED_FILES[@]}"; do
    if [[ -f "${K8S_PATH}/${file}" ]]; then
        echo -e "${GREEN}✓${NC} ${file}"
    else
        echo -e "${RED}✗${NC} ${file} 없음"
        ERRORS=$((ERRORS + 1))
    fi
done

# 권장 파일 확인
RECOMMENDED_FILES=(
    "base/configmap.yaml"
    "base/ingress.yaml"
    "base/namespace.yaml"
)

for file in "${RECOMMENDED_FILES[@]}"; do
    if [[ -f "${K8S_PATH}/${file}" ]]; then
        echo -e "${GREEN}✓${NC} ${file}"
    else
        echo -e "${YELLOW}⚠${NC} ${file} 없음 (권장)"
        WARNINGS=$((WARNINGS + 1))
    fi
done

# 3. 시크릿 파일 검사
echo -e "${BLUE}[3/5] 시크릿 파일 검사...${NC}"

# secrets.yaml이 존재하면 경고
if [[ -f "${K8S_PATH}/base/secrets.yaml" ]]; then
    echo -e "${YELLOW}⚠${NC} secrets.yaml 발견 - .gitignore에 추가되어 있는지 확인"
    WARNINGS=$((WARNINGS + 1))

    # 실제 시크릿 값 확인
    if grep -qE "(sk-[a-zA-Z0-9]{20,}|password.*[^CHANGE_ME]|secret.*[^CHANGE_ME])" "${K8S_PATH}/base/secrets.yaml" 2>/dev/null; then
        echo -e "${RED}✗${NC} 실제 시크릿 값이 포함된 것으로 의심됨!"
        ERRORS=$((ERRORS + 1))
    fi
fi

# secrets.yaml.example 존재 확인
if [[ -f "${K8S_PATH}/base/secrets.yaml.example" ]]; then
    echo -e "${GREEN}✓${NC} secrets.yaml.example 존재"
else
    echo -e "${YELLOW}⚠${NC} secrets.yaml.example 없음"
    WARNINGS=$((WARNINGS + 1))
fi

# 4. YAML 문법 검사
echo -e "${BLUE}[4/5] YAML 문법 검사...${NC}"
if command -v yamllint &> /dev/null; then
    YAML_ERRORS=$(find "${K8S_PATH}" -name "*.yaml" -o -name "*.yml" | \
                  xargs yamllint -d relaxed 2>&1 | grep -c "error" || true)
    if [[ "$YAML_ERRORS" -eq 0 ]]; then
        echo -e "${GREEN}✓${NC} YAML 문법 정상"
    else
        echo -e "${YELLOW}⚠${NC} YAML 문법 경고: ${YAML_ERRORS}개"
        WARNINGS=$((WARNINGS + 1))
    fi
else
    echo -e "${YELLOW}⚠${NC} yamllint 없음 - 기본 검사 수행"
    # 기본 YAML 검사 (python 사용)
    for yaml_file in "${K8S_PATH}"/base/*.yaml; do
        if [[ -f "$yaml_file" ]]; then
            if python3 -c "import yaml; yaml.safe_load(open('$yaml_file'))" 2>/dev/null; then
                echo -e "${GREEN}✓${NC} $(basename "$yaml_file")"
            else
                echo -e "${RED}✗${NC} $(basename "$yaml_file") - YAML 파싱 오류"
                ERRORS=$((ERRORS + 1))
            fi
        fi
    done
fi

# 5. 환경별 오버레이 확인
echo -e "${BLUE}[5/5] 환경별 오버레이 확인...${NC}"
OVERLAYS=("development" "staging" "production")
for overlay in "${OVERLAYS[@]}"; do
    if [[ -d "${K8S_PATH}/overlays/${overlay}" ]]; then
        if [[ -f "${K8S_PATH}/overlays/${overlay}/kustomization.yaml" ]]; then
            echo -e "${GREEN}✓${NC} overlays/${overlay}"
        else
            echo -e "${YELLOW}⚠${NC} overlays/${overlay}/kustomization.yaml 없음"
            WARNINGS=$((WARNINGS + 1))
        fi
    else
        echo -e "${YELLOW}⚠${NC} overlays/${overlay} 디렉토리 없음"
        WARNINGS=$((WARNINGS + 1))
    fi
done

# 결과 요약
echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  검증 결과${NC}"
echo -e "${BLUE}========================================${NC}"

if [[ $ERRORS -eq 0 ]] && [[ $WARNINGS -eq 0 ]]; then
    echo -e "${GREEN}모든 검사 통과!${NC}"
    exit 0
elif [[ $ERRORS -eq 0 ]]; then
    echo -e "${YELLOW}경고: ${WARNINGS}개${NC}"
    echo -e "${GREEN}에러 없음 - 배포 가능${NC}"
    exit 0
else
    echo -e "${RED}에러: ${ERRORS}개${NC}"
    echo -e "${YELLOW}경고: ${WARNINGS}개${NC}"
    echo -e "${RED}에러를 수정한 후 다시 검증하세요${NC}"
    exit 1
fi
