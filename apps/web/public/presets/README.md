# 프리셋 캐릭터 이미지

무료 사용자가 고르는 완성된 캐릭터. 여기 있는 이미지는 Vercel CDN이 서빙하므로
런타임 비용도 생성 실패도 없다. "AI로 만든 나만의 모습"은 이것과 구분되는 유료 상품이다.

## 필요한 파일

**4캐릭터 × 4표정 = 16장**

```
bright/   neutral.png  happy.png  worried.png  playful.png
warm/     neutral.png  happy.png  worried.png  playful.png
calm/     neutral.png  happy.png  worried.png  playful.png
chic/     neutral.png  happy.png  worried.png  playful.png
```

| 폴더 | 분위기 | 어울리는 타입 |
| --- | --- | --- |
| `bright` | 밝고 산뜻한 | 햇살, 장난 |
| `warm` | 따뜻하고 포근한 | 잔잔 |
| `calm` | 차분하고 지적인 | 든든 |
| `chic` | 시크하고 도시적인 | 고요 |

폴더 이름은 `packages/shared/src/presets.ts` 의 `PRESET_CHARACTERS` 와 일치해야 한다.
캐릭터 4명의 성별 구성은 자유다 — 코드는 상관하지 않는다.

## 만드는 순서가 중요하다

한 캐릭터의 4장이 **같은 사람으로 보여야** 한다. 얼굴·머리·옷·배경이 흔들리면
표정을 바꿀 때 화면이 튄다. 그래서 반드시 이 순서로 만든다.

1. `neutral` 한 장을 먼저 만든다
2. **그 이미지를 입력으로 넣고** 표정만 바꿔 편집한다
   (예: "같은 인물, 같은 옷, 같은 배경. 표정만 환하게 웃는 얼굴로.")
3. 나머지 표정도 **전부 1번 이미지에서** 편집한다

2번 결과에서 또 편집하면 조금씩 어긋나 누적된다.

## 규격

- 상반신 정면, 얼굴이 위쪽 1/3에 오도록
- 배경은 단색이나 아주 단순하게. 4장이 동일해야 한다
- 정사각형 1024×1024
- PNG로 저장 (WebP 변환은 스크립트가 한다)
- 선정적이지 않게, 성인의 모습으로

## 변환

```bash
pnpm --filter @mysoulmate/web presets:optimize
```

PNG를 768px WebP로 줄인다(장당 1MB+ → 100KB 안쪽). 원본보다 새 WebP가 있으면 건너뛴다.

**PNG는 커밋되지 않는다**(`.gitignore`). WebP만 저장소에 올라가고 원본은 로컬에 남는다.
표정을 추가하거나 다시 뽑을 때 필요하니 원본은 따로 보관해두는 게 좋다.

## 표정을 늘리려면

`packages/shared/src/presets.ts` 의 `EXPRESSIONS` 와 `EMOTION_TAGS` 에 추가하고
파일을 넣으면 된다. 파일이 없으면 `neutral` 로 떨어지므로 중간 상태에서도 깨지지 않는다.
