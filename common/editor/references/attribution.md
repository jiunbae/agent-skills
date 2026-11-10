# Attribution

이 스킬의 의미 보존, 국소 수정, 장르 유지, 과윤문 방지, 단일 규칙 원본과 결정적 검증 설계는 [epoko77-ai/im-not-ai](https://github.com/epoko77-ai/im-not-ai)에서 영감을 받아 사내 사용 목적에 맞게 단순화하고 다시 구현했다.

`compression` 범주의 규칙은 [snflkd/fluent-korean](https://github.com/snflkd/fluent-korean)이 정리한
진단에서 영감을 받았다. 원본은 모델이 한국어를 생성하기 전에 규율하는 output-style이고 이 스킬은
이미 작성된 초안을 편집하므로, 지침 문구를 옮기지 않고 조사·어미 생략, 명사구 종결, 관형격 연쇄,
엠대시 함축, 비유 어휘 대체라는 실패 유형만 편집 신호로 다시 표현했다.

`prose-style.md`의 기본 문체 기준과 영어 상투어·대비 구문·지어낸 이름표 규칙은 OpenAI의
[GPT-6 Astra personality and writing style](https://developers.openai.com/api/docs/guides/latest-model#gpt-6-astra-personality-and-writing-style)
가이드에서 제시한 프롬프트 권고를 편집 신호로 다시 표현했다. 원문은 모델이 글을 생성하기 전에
문체를 지시하는 프롬프트이고 이 스킬은 이미 작성된 초안을 편집하므로, 지시문을 옮기지 않고
어떤 표현을 어떤 예외 아래 고칠지로 바꿔 적었다.

`FM-07`(영문·숫자 뒤 조사 띄어쓰기), `FM-08`(띄어 쓴 가운뎃점 나열), `FM-09`(장식 별표와 이모지),
`TP-13`(교훈형 마무리), `TP-14`(블로그 인사 상투구), `CP-05`(한국어 문장 속 엠대시), 그리고 `TR-01`·`TR-04`·`HG-04`·`CO-02`의
변형 확장은 [leeandev/stop-slop-ko](https://github.com/leeandev/stop-slop-ko)의 `slop_scan.py` 검사 항목을 참고했다.
`TR-04`, `FM-07`, `TP-14`의 정규식은 원본 패턴을 바탕으로 이 스킬의 예외 정책(한 글자 기호 나열 제외, 줄 단위 집계,
제목 이모지 중복 제외 등)에 맞게 고쳤다. 원본은 경고 등급으로 실패 처리하는 검사기이고 이 스킬은 수정 근거를 알려 주는
분석기이므로, 등급과 최소 발생 횟수는 이 스킬의 보존 퇴고 원칙에 맞춰 다시 정했다.

## im-not-ai 라이선스

```text
MIT License

Copyright (c) 2026 epoko77-ai

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## fluent-korean 라이선스

```text
MIT License

Copyright (c) 2026 snflkd

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OF OR IN CONNECTION WITH
THE SOFTWARE.
```

## stop-slop-ko 라이선스

```text
MIT License

Copyright (c) 2026 leeandev

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
