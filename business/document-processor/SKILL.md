---
name: processing-documents
description: Processes PDF, DOCX, XLSX, PPTX documents including analysis, summarization, and format conversion. Use for "문서 분석", "PDF 변환", "Excel 추출", "문서 요약" requests or when working with office documents.
---

# Document Processor

Analyze, summarize, and convert office documents.

## Supported Formats

| Format | Read | Write | Tools |
|--------|------|-------|-------|
| PDF | ✅ | ✅ | pdfplumber, pypdf |
| DOCX | ✅ | ✅ | python-docx |
| XLSX | ✅ | ✅ | openpyxl |
| PPTX | ✅ | ✅ | python-pptx |

## Quick Reference

### PDF Text Extraction

```python
import pdfplumber
with pdfplumber.open("doc.pdf") as pdf:
    text = "\n".join(p.extract_text() for p in pdf.pages)
```

### Excel Reading

```python
import openpyxl
wb = openpyxl.load_workbook("data.xlsx")
ws = wb.active
data = [[cell.value for cell in row] for row in ws.iter_rows()]
```

### Word Document

```python
from docx import Document
doc = Document("report.docx")
text = "\n".join(p.text for p in doc.paragraphs)
```

## Workflows

### Summarize PDF
1. Extract text with pdfplumber
2. Pass to Claude for summarization
3. Output markdown summary

### Convert Excel to CSV
```python
import pandas as pd
df = pd.read_excel("data.xlsx")
df.to_csv("data.csv", index=False)
```

### Extract Tables from PDF
```python
with pdfplumber.open("doc.pdf") as pdf:
    tables = pdf.pages[0].extract_tables()
```

## Best Practices

- Use pdfplumber for complex PDFs (tables, layouts)
- Use pypdf for simple text extraction
- Convert to markdown for AI processing
