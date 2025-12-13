---
name: document-processor
description: 통합 문서 처리 스킬. PDF, DOCX, XLSX, PPTX 문서 분석/요약/변환. "문서 분석", "PDF 변환", "Excel 추출", "문서 요약" 요청 시 활성화됩니다.
---

# Document Processor - 통합 문서 처리

## Overview

PDF, Word, Excel, PowerPoint 문서를 **분석 → 요약 → 변환/내보내기**하는 통합 스킬입니다.

**핵심 기능:**
- **문서 분석**: 텍스트, 테이블, 이미지 추출
- **AI 요약**: 문서 내용 자동 요약
- **포맷 변환**: 문서 간 변환 (PDF↔DOCX, XLSX→CSV 등)
- **데이터 내보내기**: JSON, CSV, Markdown으로 추출

**지원 포맷:**

| 포맷 | 읽기 | 쓰기 | 변환 대상 |
|------|:----:|:----:|----------|
| PDF | ✅ | ✅ | TXT, MD, DOCX |
| DOCX | ✅ | ✅ | PDF, MD, TXT |
| XLSX | ✅ | ✅ | CSV, JSON, MD |
| PPTX | ✅ | ✅ | PDF, MD, 이미지 |

## When to Use

이 스킬은 다음 상황에서 활성화됩니다:

**명시적 요청:**
- "문서 분석해줘", "문서 요약해줘"
- "PDF를 Word로 변환"
- "Excel 데이터 추출해줘"
- "PPT 내용 요약해줘"

**자동 활성화:**
- 문서 파일(.pdf, .docx, .xlsx, .pptx) 처리 요청 시
- 포맷 변환이나 데이터 추출 작업 시

## Workflow

### 1. 문서 분석 및 요약

```
사용자: "이 PDF 문서 분석하고 요약해줘"

워크플로우:
1. 문서 포맷 감지 (확장자)
2. 적절한 추출 방법 선택
3. 텍스트/테이블 추출
4. AI 요약 생성
5. 결과 출력
```

### 2. 포맷 변환

```
사용자: "이 Word 문서를 PDF로 변환해줘"

워크플로우:
1. 소스 문서 읽기
2. LibreOffice로 변환
3. 결과 파일 저장
```

### 3. 데이터 추출 및 내보내기

```
사용자: "이 Excel에서 데이터 추출해서 JSON으로"

워크플로우:
1. Excel 파일 읽기
2. pandas로 데이터 파싱
3. JSON으로 내보내기
```

---

## 문서 분석 방법

### PDF 분석

```python
# 텍스트 추출
import pdfplumber

with pdfplumber.open("document.pdf") as pdf:
    text = ""
    tables = []
    for page in pdf.pages:
        text += page.extract_text() or ""
        tables.extend(page.extract_tables())
```

```bash
# 또는 명령줄로
pdftotext -layout document.pdf output.txt
```

### DOCX 분석

```bash
# Markdown으로 변환 (구조 보존)
pandoc --track-changes=all document.docx -o output.md
```

### XLSX 분석

```python
import pandas as pd

# 모든 시트 읽기
all_sheets = pd.read_excel('file.xlsx', sheet_name=None)

for sheet_name, df in all_sheets.items():
    print(f"=== {sheet_name} ===")
    print(df.head())
    print(df.describe())
```

### PPTX 분석

```bash
# Markdown으로 텍스트 추출
python -m markitdown presentation.pptx > output.md
```

---

## 포맷 변환 레시피

### PDF → 텍스트/Markdown

```bash
# 텍스트 추출 (레이아웃 보존)
pdftotext -layout input.pdf output.txt

# Markdown으로 (pandoc)
pandoc input.pdf -o output.md
```

### DOCX → PDF

```bash
# LibreOffice 사용
soffice --headless --convert-to pdf document.docx

# 출력: document.pdf
```

### DOCX → Markdown

```bash
pandoc document.docx -o output.md
```

### XLSX → CSV

```python
import pandas as pd

df = pd.read_excel('input.xlsx')
df.to_csv('output.csv', index=False)
```

### XLSX → JSON

```python
import pandas as pd

df = pd.read_excel('input.xlsx')
df.to_json('output.json', orient='records', force_ascii=False, indent=2)
```

### PPTX → PDF

```bash
soffice --headless --convert-to pdf presentation.pptx
```

### PPTX → 이미지

```bash
# PDF로 변환 후 이미지로
soffice --headless --convert-to pdf presentation.pptx
pdftoppm -jpeg -r 150 presentation.pdf slide
# 결과: slide-1.jpg, slide-2.jpg, ...
```

---

## AI 요약 생성

문서 내용을 추출한 후, Claude에게 요약을 요청합니다.

### 요약 템플릿

**짧은 요약** (1-2문장):
```
이 문서의 핵심 내용을 한두 문장으로 요약해줘.
```

**구조화된 요약**:
```
이 문서를 다음 형식으로 요약해줘:
1. 핵심 주제
2. 주요 포인트 (3-5개)
3. 결론/권장사항
```

**섹션별 요약**:
```
이 문서의 각 섹션을 개별적으로 요약해줘.
```

---

## 데이터 추출 패턴

### 테이블 추출 (PDF)

```python
import pdfplumber
import pandas as pd

with pdfplumber.open("document.pdf") as pdf:
    all_tables = []
    for page in pdf.pages:
        tables = page.extract_tables()
        for table in tables:
            if table and len(table) > 1:
                df = pd.DataFrame(table[1:], columns=table[0])
                all_tables.append(df)

    # 합치기
    if all_tables:
        combined = pd.concat(all_tables, ignore_index=True)
        combined.to_excel("extracted_tables.xlsx", index=False)
```

### 특정 데이터 추출 (Excel)

```python
import pandas as pd

df = pd.read_excel('data.xlsx')

# 조건부 추출
filtered = df[df['status'] == 'active']

# 특정 열만
selected = df[['name', 'email', 'date']]

# JSON으로 내보내기
selected.to_json('output.json', orient='records', force_ascii=False)
```

### 메타데이터 추출 (PDF)

```python
from pypdf import PdfReader

reader = PdfReader("document.pdf")
meta = reader.metadata

info = {
    "title": meta.title,
    "author": meta.author,
    "subject": meta.subject,
    "creator": meta.creator,
    "pages": len(reader.pages)
}
```

---

## 일괄 처리

### 여러 문서 처리

```python
import os
from pathlib import Path

input_dir = Path("./documents")
output_dir = Path("./output")
output_dir.mkdir(exist_ok=True)

for file in input_dir.glob("*.pdf"):
    # 각 PDF 처리
    output_file = output_dir / f"{file.stem}.txt"
    os.system(f'pdftotext -layout "{file}" "{output_file}"')
```

### 배치 변환

```bash
# 모든 DOCX를 PDF로
for f in *.docx; do
    soffice --headless --convert-to pdf "$f"
done
```

---

## 통합 파이프라인 예시

### 예시 1: 계약서 분석

```
입력: contract.pdf
출력: 요약 + 주요 조항 + 날짜/금액 추출

1. PDF에서 텍스트 추출
2. 계약 당사자, 계약일, 금액 추출
3. 주요 조항 요약
4. JSON으로 구조화된 결과 출력
```

### 예시 2: 재무 보고서 변환

```
입력: financial_report.xlsx
출력: PDF 보고서 + JSON 데이터

1. Excel에서 데이터 추출
2. 요약 통계 생성
3. PDF 보고서 생성
4. 원본 데이터 JSON 내보내기
```

### 예시 3: 프레젠테이션 요약

```
입력: presentation.pptx
출력: Markdown 요약 + 슬라이드 이미지

1. PPTX에서 텍스트 추출
2. 각 슬라이드 요약
3. 슬라이드를 이미지로 변환
4. Markdown 문서 생성 (이미지 포함)
```

---

## 제한 사항

### 변환 제한

| 변환 | 지원 | 비고 |
|------|------|------|
| PDF → DOCX | △ | 레이아웃 손실 가능 |
| 이미지 PDF → 텍스트 | △ | OCR 필요 (pytesseract) |
| 복잡한 수식 | △ | 수식 보존 어려움 |
| 암호화된 PDF | × | 비밀번호 필요 |

### 품질 참고

- **PDF 추출**: 스캔 문서는 OCR 필요
- **테이블 추출**: 복잡한 테이블은 수동 검증 필요
- **포맷 변환**: 원본 스타일 100% 보존 어려움

---

## Examples

### 예시 1: PDF 문서 요약

```
사용자: 이 계약서.pdf 핵심 내용 요약해줘

Claude: PDF 문서를 분석합니다...

## 계약서 요약

**당사자**: A사 ↔ B사
**계약일**: 2025-01-15
**계약금액**: 5,000만원

**주요 조항**:
1. 납품 기한: 2025-03-31
2. 지체상금: 일 0.1%
3. 하자보증: 1년
```

### 예시 2: Excel → JSON 변환

```
사용자: 고객목록.xlsx를 JSON으로 변환해줘

Claude: Excel 파일을 JSON으로 변환합니다...

[저장됨: 고객목록.json]
{
  "customers": [
    {"id": 1, "name": "홍길동", "email": "hong@example.com"},
    ...
  ]
}
```

---

## Best Practices

**DO:**
- 대용량 문서는 페이지 범위 지정하여 처리
- 변환 전 원본 백업
- OCR 결과는 수동 검증
- 테이블 추출 후 데이터 정합성 확인

**DON'T:**
- 암호화된 문서 무리하게 처리 시도
- 복잡한 레이아웃 문서의 완벽한 변환 기대
- OCR 없이 스캔 PDF 텍스트 추출 시도
- 원본 파일 직접 수정

---

## Prerequisites

```bash
# Python 라이브러리
pip install pypdf pdfplumber pandas openpyxl python-pptx markitdown

# 시스템 도구
sudo apt-get install poppler-utils pandoc libreoffice

# OCR (선택)
pip install pytesseract pdf2image
sudo apt-get install tesseract-ocr
```

---

## Troubleshooting

### PDF 텍스트 추출 실패
- **원인**: 스캔된 이미지 PDF
- **해결**: OCR 사용 (`pytesseract`)

### 테이블 추출 불완전
- **원인**: 복잡한 병합 셀 구조
- **해결**: 수동으로 영역 지정하거나 Excel로 재작성

### LibreOffice 변환 오류
- **원인**: LibreOffice 미설치 또는 경로 문제
- **해결**: `which soffice`로 경로 확인, 재설치
