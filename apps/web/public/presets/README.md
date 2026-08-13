# 프리셋 캐릭터 이미지

무료 사용자가 고르는 완성된 캐릭터. 여기 있는 이미지는 Vercel CDN이 서빙하므로
런타임 비용도 생성 실패도 없다. "AI로 만든 나만의 모습"은 이것과 구분되는 유료 상품이다.

## 필요한 파일

원본 PNG는 저장소 루트의 **`img/SoulMate/`** 에 넣는다. 이 폴더(`public/presets/`)에는
스크립트가 만든 WebP만 들어간다.

```bash
pnpm --filter @mysoulmate/web presets:optimize
```

원본 파일명은 `{성별}_{분위기}_{표정}.png` 다. `w` = 여성, `m` = 남성.
표정은 `normal` / `happy` / `worried` / `playful` — `normal` 이 코드의 `neutral` 이 된다.

```
img/SoulMate/w_bright_normal.png  ->  public/presets/w_bright/neutral.webp
img/SoulMate/m_calm_happy.png     ->  public/presets/m_calm/happy.webp
```

**8프리셋 × 4표정 = 32장**

| 프리셋 | 성별 | 분위기 | 어울리는 타입 |
| --- | --- | --- | --- |
| `w_bright` / `m_bright` | 여성 / 남성 | 밝고 산뜻한 | 햇살, 장난 |
| `w_warm` / `m_warm` | 여성 / 남성 | 따뜻하고 포근한 | 잔잔 |
| `w_calm` / `m_calm` | 여성 / 남성 | 차분하고 지적인 | 든든 |
| `w_chic` / `m_chic` | 여성 / 남성 | 시크하고 도시적인 | 고요 |

프리셋을 추가하려면 원본을 `img/SoulMate/` 에 넣고 위 스크립트를 돌린 뒤
`packages/shared/src/presets.ts` 의 `PRESET_CHARACTERS` 에 한 항목을 더한다.

스크립트는 필요한 목록을 `PRESET_CHARACTERS × EXPRESSIONS` 에서 가져오므로,
빠진 파일이 있으면 끝에 이름을 찍어준다. 손으로 복사·개명하지 않는다 —
그렇게 하다가 `m_chic_normal.png` 누락을 놓쳤다.

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
- 배경은 단색. 분위기는 배경 **색으로만** 준다 (소품이 있으면 표정 편집할 때 흔들린다)
- 정사각형 1024×1024
- PNG로 저장 (WebP 변환은 스크립트가 한다)
- 선정적이지 않게, 성인의 모습으로

## 화풍은 코드와 같아야 한다

AI로 생성하는 아바타와 같은 화풍이어야 한다. 유료로 "나만의 모습" 을 만든 순간
화풍이 달라지면 같은 서비스로 보이지 않는다.

기준 문자열은 `packages/shared/src/art-style.ts` 의 `ART_STYLE_PROMPT` 하나뿐이다.
아래는 그걸 그대로 옮긴 것이고, 바꿀 일이 있으면 **그 파일을 고치고 여기도 맞춰야 한다.**

```
Soft Korean webtoon illustration style. Clean confident line art,
gentle cel shading with soft gradients, warm muted color palette,
delicate expressive facial features. Not photorealistic, not 3D render.
No text, no watermark, no signature.
```

## 캐릭터별 프롬프트

### 1단계 — 기본(normal) 한 장씩

| 프리셋 | 성별 | 배경색 |
| --- | --- | --- |
| `w_bright` / `m_bright` | 여성 / 남성 | 밝은 크림 |
| `w_warm` / `m_warm` | 여성 / 남성 | 따뜻한 베이지 |
| `w_calm` / `m_calm` | 여성 / 남성 | 차분한 회청색 |
| `w_chic` / `m_chic` | 여성 / 남성 | 짙은 차콜 |

```
Upper-body portrait of an adult woman in her late twenties, facing the viewer.
Square 1:1 composition, head in the upper third of the frame,
hands visible at chest level in a relaxed natural pose.
Mood: bright and fresh — light airy styling, open friendly presence.
Background: a single flat pale cream color, completely plain, no props, no pattern.
An adult, tasteful and fully clothed.
Soft Korean webtoon illustration style. Clean confident line art,
gentle cel shading with soft gradients, warm muted color palette,
delicate expressive facial features. Not photorealistic, not 3D render.
No text, no watermark, no signature.
```

캐릭터마다 `woman`/`man`, `Mood:`, `Background:` 세 줄만 바꾼다.

- `warm` — `Mood: warm and comforting — soft knit textures, gentle presence.` / `flat warm beige`
- `calm` — `Mood: composed and intelligent — neat tailored styling, quiet confidence.` / `flat muted blue-grey`
- `chic` — `Mood: sharp and urban — monochrome styling, cool composed presence.` / `flat deep charcoal`

### 2단계 — 표정 3장

**1단계 이미지를 첨부**하고 아래를 넣는다.

```
Keep the exact same character from the provided image: same face, same hairstyle,
same clothing, same background color, same framing, same art style.
Change ONLY the facial expression and hand gesture to:
<표정>
```

`<표정>` 자리:

- **happy** — `a bright genuine smile, eyes slightly narrowed with joy, one hand raised near the shoulder in a small cheerful wave`
- **worried** — `a gentle concerned expression, brows slightly drawn together, one hand lightly resting on own chest in empathy`
- **playful** — `a mischievous grin, one eye winking, one hand near the cheek making a small playful gesture`

세 장 모두 **1단계 이미지에서** 편집한다. happy 결과에서 worried를 만들면 어긋남이 누적된다.

손은 이미지 모델이 가장 자주 망치는 부분이다(손가락 개수, 뒤틀림). 감정 전달에는
도움이 되지만 몇 번 다시 뽑아야 할 수 있다. 잘 안 나오면 `hands visible at chest level`
을 빼고 표정만으로 가도 된다 — 코드는 상관하지 않는다.

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
