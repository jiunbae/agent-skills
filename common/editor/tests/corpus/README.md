# 회귀 예문

각 쌍은 같은 내용을 담은 고치기 전(`*.before.md`)과 고친 뒤(`*.after.md`) 초안이다. `tests/test_editor.py`의 `RegressionCorpusTests`가 고치기 전 초안에서 기대한 신호가 기대한 횟수로 잡히는지, 고친 뒤 초안에서 그 신호가 사라지는지 확인한다. 고친 뒤 초안 전체가 무신호일 필요는 없다.

- `report`: 개조식 실무 보고서. 부호, 번역투, 조사 앞 공백. 신호 유형은 [leeandev/stop-slop-ko](https://github.com/leeandev/stop-slop-ko)(MIT)의 예시를 참고해 예문을 새로 썼다.
- `blog`: 서술형 블로그 글. 인사 도입, 교훈형 마무리, 대비 구문, '~라 할 수 있다'.
- `narrative`: 진행형 '~고 있다'가 반복되는 서술. 소설가 허관이 공개한 글쓰기 팁의 유형을 참고해 예문을 새로 썼다.
- `compressed`: 조사와 서술어가 빠진 압축 보고. `~/.agents/KOREAN.md` 규칙 1, 4, 8의 예문을 썼다.
