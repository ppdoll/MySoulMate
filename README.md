# MySoulMate

구글로 로그인한 사용자마다 고유한 성격과 외형을 가진 AI 소울메이트를 만들고,
무료 대화 쿼터를 넘으면 크레딧으로 대화를 이어가는 웹 서비스.

설계 배경과 전체 로드맵은 계획서(`~/.claude/plans/bubbly-waddling-mango.md`)에 있다.

---

## 구조

```
apps/web      Next.js 16 (App Router)   → Vercel 프로젝트 A
apps/api      NestJS 11                 → Vercel 프로젝트 B
packages/shared  zod 스키마 + 상수       ← web과 api가 공유하는 계약
supabase/migrations  DB 스키마와 함수
```

web과 api는 오리진이 다르다. 세션 쿠키 대신 **Supabase 액세스 토큰을 Bearer로** 보내고,
api는 Supabase JWKS로 서명만 로컬 검증한다(Auth 서버 왕복 없음).

비즈니스 데이터는 전부 api(service_role)를 통해서만 접근한다.
모든 테이블은 RLS를 켜고 정책을 만들지 않아 브라우저의 직접 접근이 차단돼 있다.

---

## 사전 준비

- Node.js **22 이상 권장** (20.16에서도 동작하지만 `@supabase/supabase-js`가 20을 deprecate 했고,
  Node 20에는 전역 `WebSocket`이 없어 `apps/api`가 `ws` 폴백을 태운다. Vercel 런타임은 Node 22다.)
- pnpm 9 이상
- Supabase 계정, Google Cloud 계정, Vercel 계정
- DB 마이그레이션을 로컬에서 검증하려면 WSL + PostgreSQL + pgvector (Docker는 쓰지 않는다)

---

## 1. 초기 설정 — [docs/SETUP.md](docs/SETUP.md)

Supabase 프로젝트 생성 → 마이그레이션 적용 → Google 로그인 연결까지
클릭 단위로 링크를 달아 정리해 두었다. 처음이라면 그쪽을 그대로 따라간다.

요약하면:

1. [Supabase 프로젝트](https://supabase.com/dashboard/projects) 2개 생성 (dev / prod, 무료 플랜 상한)
2. [SQL Editor](https://supabase.com/dashboard/project/_/sql/new)에서 `supabase/migrations/*.sql` 을 **번호 순서대로** 실행
3. [Google Auth Platform](https://console.cloud.google.com/auth/clients/create)에서 OAuth 클라이언트를 만들고
   [Supabase Google 프로바이더](https://supabase.com/dashboard/project/_/auth/providers)에 연결
4. `.env.example` 을 복사해 값 채우기

키는 [Settings › API Keys](https://supabase.com/dashboard/project/_/settings/api-keys)에서 가져온다.

| 어디 | 키 | 비고 |
| --- | --- | --- |
| api | `SUPABASE_SECRET_KEY` | `sb_secret_...`. RLS를 우회한다. 프론트/저장소에 절대 노출 금지 |
| api | `WEB_ORIGIN` | 쉼표로 여러 개. 프리뷰 배포 도메인도 넣어야 CORS가 통과한다 |
| web | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_...`. 공개되어도 되는 키 |
| web | `NEXT_PUBLIC_API_URL` | 로컬 `http://localhost:3001`, 배포는 api 쪽 도메인 |

구형 프로젝트의 `anon` / `service_role` JWT 키를 넣어도 동작하지만
[2026년 말 폐기 예정](https://supabase.com/docs/guides/api/api-keys)이라 새 키를 쓴다.

---
## 2. 로컬 실행

```bash
pnpm install
```

```bash
pnpm dev
```

web은 `http://localhost:3000`, api는 `http://localhost:3001`.

api만 따로 띄우려면:

```bash
pnpm --filter @mysoulmate/api dev
```

배포 전에는 Vercel 런타임에서도 부팅되는지 한 번 확인하는 게 좋다.
로컬 `nest start`만으로는 배포 실패를 못 잡는다:

```bash
pnpm --filter @mysoulmate/api exec vercel dev
```

---

## 3. Vercel 배포

같은 저장소로 **프로젝트 2개**를 만들고 Root Directory만 다르게 지정한다.

| | 프로젝트 A | 프로젝트 B |
| --- | --- | --- |
| Root Directory | `apps/web` | `apps/api` |
| Framework | Next.js (자동 감지) | Other / NestJS (자동 감지) |
| Build Command | 기본값 (package.json의 `build`) | 기본값 |

- **"Include files outside of the Root Directory"를 켜야** pnpm workspace가 해석된다.
  이게 꺼져 있으면 `@mysoulmate/shared`를 찾지 못해 빌드가 깨진다.
- 각 앱의 `build` 스크립트가 `@mysoulmate/shared`를 먼저 빌드하므로 별도 설정은 필요 없다.
- 환경변수는 두 프로젝트에 각각 등록한다. api에는 `WEB_ORIGIN`을 web 배포 도메인으로 맞춘다.

NestJS는 zero-config로 올라간다. `apps/api/src/main.ts`가 엔트리포인트로 자동 인식되고
앱 전체가 Fluid compute 함수 하나가 된다. serverless-express 래퍼는 필요 없다.

> **수익화 시점에는 Pro로 올려야 한다.** Vercel Hobby는 상업적 이용(결제·광고)이 약관상 금지다.
> M0~M3(로그인·온보딩·대화)까지는 Hobby로 진행해도 된다.

### GitHub Actions 시크릿

`.github/workflows/keepalive.yml`이 Supabase 일시정지를 막는다.
저장소 Settings › Secrets에 `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`를 등록한다.

---

## 4. 동작 확인

```bash
curl http://localhost:3001/health
```

```bash
curl -i http://localhost:3001/me
```

앞은 `{"status":"ok",...}`, 뒤는 `401 {"code":"unauthorized",...}`가 나와야 한다.

브라우저에서 `http://localhost:3000` → 구글 로그인 → `/home`에서
이름·무료 대화 잔여·크레딧·초대 코드가 보이면 M1까지 정상이다.

### 마이그레이션 + 크레딧 동시성 테스트 (WSL)

크레딧 차감은 이 프로젝트에서 가장 깨지기 쉬운 부분이다. 탭 여러 개에서 동시에 보내면
잔액이 음수가 되거나 한 번 낼 크레딧으로 두 번 쓰는 사고가 나기 쉽다.

WSL의 PostgreSQL로 검증한다. Windows에서:

```bash
wsl bash supabase/test/run.sh
```

WSL 안에서 직접 돌린다면:

```bash
bash supabase/test/run.sh
```

`/tmp`에 **일회용 클러스터를 새로 만들어** 쓰고 끝나면 지운다.
평소 쓰는 클러스터(보통 5432)와 그 데이터는 건드리지 않고, TCP를 열지 않아 포트도 충돌하지 않는다.

하는 일:

1. Supabase 기본 객체(`auth.users` 등)를 스텁으로 만든다
2. `supabase/migrations/*.sql` 를 순서대로 적용한다
3. 잔액 5인 계정에 동시 차감 20건을 던진다
4. **정확히 5건만** 통과했고 `원장 합계 == 잔액`인지 검증한다

마지막에 `PASS: ...` 가 찍혀야 한다. 실패하면 `spend_credits`의 `FOR UPDATE` 잠금부터 본다.

### 테스트 환경 준비 (한 번만)

PostgreSQL이 없다면:

```bash
sudo apt-get install -y postgresql postgresql-contrib
```

pgvector는 Ubuntu 기본 저장소에 없어서 PGDG를 붙여야 한다:

```bash
sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y && sudo apt-get install -y postgresql-14-pgvector
```

pgvector가 없어도 스크립트는 돌아간다 — `memories.embedding`을 `text`로 치환해 적용하고
그 사실을 출력에 알린다. 다만 그러면 embedding 컬럼 타입만은 검증되지 않으니,
설치해두면 마이그레이션이 원본 그대로 확인된다.

---

## 5. 되돌려진 응답 보기 (운영)

사용자가 `되돌리기` 나 `다시 답하기` 를 누르면 그 응답이 `rejected_messages` 에 남는다.
"이 응답은 실패했다"를 사용자가 직접 달아준 라벨이라, 프롬프트를 감이 아니라 근거로 고칠 수 있다.
Supabase SQL Editor에서:

```sql
select r.created_at at time zone 'Asia/Seoul' as 시각,
       r.action, s.tone, r.emotion,
       r.user_text as 사용자, r.answer as 응답
  from public.rejected_messages r
  join public.soulmates s on s.id = r.soulmate_id
 order by r.created_at desc
 limit 50;
```

`action = 'regenerate'` 가 더 강한 불만이다 — 크레딧을 더 내고서라도 바꾸고 싶었다는 뜻이라서.
같은 감정 태그나 같은 톤에서 반복해서 나온다면 그 구간의 프롬프트를 의심한다.

기록은 소울메이트를 지우면(다시 만들기 포함) 함께 사라진다.
사용자 대화 내용이 남는 것이므로 **개인정보처리방침(M7)에 반드시 명시해야 한다.**

---

## 6. 법률 문서와 Google OAuth 게시 (M7)

`/privacy`(개인정보 처리방침)와 `/terms`(이용약관)가 있고, 가입 화면에서 필수 동의 네 가지를
확인받는다. 만 14세 이상만 이용할 수 있다.

### 배포 전 반드시 채울 것

[`apps/web/src/lib/legal.ts`](apps/web/src/lib/legal.ts)의 `LEGAL` 상수에 `[확인 필요: ...]`로
비워둔 값이 **화면에 그대로 보인다.** 추측해서 채우지 않았다 — 개인정보 보호책임자의 성명과
연락처는 법정 공개 항목이라(개인정보보호법 제30조 제1항 제6호) 잘못 적으면 방침이 성립하지 않는다.

- `operatorName` — 운영 주체 (법인이면 상호, 개인이면 본인 이름)
- `domain` — 서비스 주소
- `cpo.name` · `cpo.phone` · `cpo.email` — 개인정보 보호책임자
- `mailingAddress` — 우편으로 권리 행사 요청을 받을 주소
- `storageCountry` — Supabase 리전 국가 (대시보드 > Project Settings > General.
  `ap-northeast-2`면 대한민국)

남아 있는지 확인하려면 `unresolvedLegalFields()`가 빈 배열을 돌려주는지 보면 된다.

### 문서의 출처가 두 갈래다

| 문서 | 출처 | 검토 강도 |
|---|---|---|
| `/privacy` | [kimlawtech/korean-privacy-terms](https://github.com/kimlawtech/korean-privacy-terms) (Apache-2.0) 템플릿 `pin e390f7b` | 변호사 검토 필요 |
| `/terms` | **템플릿 없음.** 공정거래위원회 전자상거래 표준약관 제10023호 구성과 약관규제법을 참고해 직접 작성 | **더 꼼꼼한 검토 필요** |

업스트림에는 한국어 이용약관 템플릿이 빈 파일로만 있다(최신 main도 동일). 그래서 약관은
검증된 템플릿을 거치지 않았다. 특히 크레딧의 법적 성질, 환불 조항, 면책 범위, 관할 조항은
약관규제법상 무효가 되기 쉬운 지점이다.

두 문서 모두 **참고용 초안이며 법률 자문이 아니다. 실서비스 배포 전 변호사 검토가 필요하다.**
템플릿은 2026.9.11 시행 개정 개인정보보호법 기준으로 반영돼 있고, 그 이후 개정 반영은
확인 책임이 운영자에게 있다.

### 쿠키 배너를 만들지 않은 이유

로그인 유지에 필요한 필수 쿠키만 쓰고 추적 도구(GA·Meta Pixel 등)를 붙이지 않았다.
행태정보를 수집하지 않으므로 동의 배너가 필요하지 않다. 분석 도구를 도입하면 그때 붙인다.

### Google OAuth 게시

동의 화면을 테스트에서 **게시(production)** 로 올릴 때 개인정보처리방침과 이용약관 URL이
실제로 열려야 한다. `*.vercel.app` 으로도 신청은 되지만 도메인 소유 확인이 안 돼서 심사가
길어질 수 있으니, 커스텀 도메인을 붙이는 편이 낫다(`LEGAL.domain` 한 곳만 바꾸면 된다).

---

## 7. PWA — 홈 화면에 설치

매일 들르는 서비스라 브라우저 탭보다 아이콘으로 여는 편이 자연스럽다.
매니페스트와 아이콘, 서비스 워커, 설치 안내가 들어가 있다.

| 파일 | 하는 일 |
| --- | --- |
| [`src/app/manifest.ts`](apps/web/src/app/manifest.ts) | `/manifest.webmanifest` 생성. `start_url` 은 `/home` |
| `public/icons/*` | `icons:pwa` 로 `icon.svg` 하나에서 뽑는다 |
| [`public/sw.js`](apps/web/public/sw.js) | 설치 프롬프트 조건 + 오프라인 화면 |
| [`src/components/install-prompt.tsx`](apps/web/src/components/install-prompt.tsx) | 홈 화면 추가 버튼(안드로이드) / 방법 안내(iOS) |

```bash
pnpm --filter @mysoulmate/web icons:pwa
```

### 앱 셸을 캐시하지 않는다

의도적이다. JS·HTML 을 캐시해두면 배포한 뒤에도 사용자가 옛 코드를 계속 쓰게 되고
그걸 알아채기가 아주 어렵다. 대화가 전부 서버를 거치는 서비스라 오프라인 캐시로 얻을
것도 거의 없다. 서비스 워커가 캐시하는 건 `/offline` 한 장뿐이고, 정적 자원은
Next.js 가 붙이는 HTTP 헤더에 맡긴다.

### 서비스 워커는 배포본에서만 등록된다

개발 중에 워커가 살아 있으면 코드를 고쳐도 옛 응답이 섞여 "왜 안 바뀌지" 로 시간을
버린다. 확인이 필요하면 프로덕션으로 띄운다.

```bash
pnpm --filter @mysoulmate/web build && pnpm --filter @mysoulmate/web start
```

### 설치 요건

Chrome 은 **메뉴에서 설치**는 서비스 워커 없이도 허용하지만(모바일 108 / 데스크톱 112부터),
**자동으로 뜨는 설치 배너**는 여전히 `fetch` 핸들러가 있는 워커를 요구한다.
그래서 워커를 둔다. iOS Safari 는 설치 프롬프트 API 가 없어서 공유 → 홈 화면에 추가를
글로 안내하는 수밖에 없다.

### viewport-fit=cover 를 쓴다

설치 상태에서 화면 끝까지 그린다. 켜지 않으면 iOS 가 노치와 홈 인디케이터 자리를
비워두고 검은 띠를 남기는데, 대화 화면이 인물로 꽉 차는 배치라 그 띠가 크게 눈에 걸린다.

대신 화면 가장자리에 붙은 요소는 `env(safe-area-inset-*)` 로 자리를 비켜야 한다.
`globals.css` 의 `.safe-top` / `.safe-bottom` / `.safe-page` 가 그 일을 한다.
**새 화면을 만들 때 이 클래스를 빼먹으면** 설치 상태의 iOS 에서 아래쪽 버튼이
홈 인디케이터에 가려 눌리지 않는다. 브라우저에서는 `env()` 가 0 이라 티가 안 나므로
개발 중에 발견되지 않는다.

### 푸시 알림은 아직 없다

소울메이트가 먼저 말을 걸어오는 건 이 서비스에서 가장 강한 재방문 장치지만
제약이 세 개 겹친다.

- **Vercel Hobby 는 cron 이 하루 1회**다. "저녁에 한 번" 은 되지만 "생각날 때 랜덤하게"
  는 안 된다. Pro 전환(M6) 이후에 다시 볼 문제다.
- **iOS 는 홈 화면에 설치한 PWA 에서만** 웹 푸시가 온다(16.4+). 설치를 유도하는 이
  작업이 그 선행 조건이다.
- 알림 문구를 모델로 만들면 사용자 수 × 하루 1회의 호출이 매일 나간다.

---

## 현재 상태

완료

- M0 — 모노레포, 두 앱 빌드/배포 구성
- M1 — DB 스키마, 크레딧 원장과 동시성 방어 함수, 구글 로그인, `GET /me`
- M2 — 온보딩 10문항 → 페르소나 JSON → 프리셋/AI 아바타
- M3 — SSE 채팅, 롤링 요약, 장기 기억, 영상통화 배치
- M4 — 크레딧 차감/환불을 대화에 연결, 무료 쿼터 lazy reset
- M5 — 미션 보상: 일일 출석(연속 보너스), 온보딩 완료, 친구 초대

그 위에 얹은 것

- 사용자 소개(`나에 대해`)를 시스템 프롬프트에 자료로 주입
- 기억 관리 화면 — 보기·고치기·지우기·고정
- 되돌리기 / 다시 답하기, 그리고 되돌린 응답을 프롬프트 개선 근거로 기록
- PWA — 홈 화면 설치, 오프라인 화면, 설치 상태의 안전 영역 (위 7번 참고)
- 비파괴적 설정 수정 — 이름·관계·말투·프리셋 모습을 대화와 기억을 지키며 무료로 바꾼다.
  성격과 배경은 정체성이라 여전히 `처음부터 다시 만들기`(20크레딧) 쪽에 남는다.
  말투를 바꿀 때는 예시 문장도 새 말투로 옮긴다 — 안 하면 시스템 프롬프트의
  `말투: 존댓말` 지시문과 반말 예시가 싸워서 변경이 먹지 않는다.

### 초대 어뷰징 방어 (네 겹)

크레딧이 공짜로 생기는 유일한 경로라 따로 적어둔다. 구글 계정은 몇 분이면 만들 수 있다.

| # | 방어 | 어디에 있나 |
|---|---|---|
| 1 | 한 계정은 평생 한 번만 초대받는다 | `referrals.invitee_id UNIQUE` |
| 2 | 자기 자신은 초대할 수 없다 | `referrals_no_self` CHECK |
| 3 | 초대받은 쪽이 실제로 대화해야 지급 | `settle_referrals` |
| 4 | 초대자 상한 (하루 3명 / 누적 20명) | `settle_referrals` |

1·2는 DB 제약이라 코드가 틀려도 뚫리지 않는다.
상한에 걸린 건은 버려지지 않고 보류됐다가 다음 날 정산된다 —
초대받은 쪽이 다시 안 와도 초대자 본인이 대화할 때 대기열이 풀린다.

- M7 — 개인정보 처리방침, 이용약관, 가입 동의, 회원 탈퇴 (위 6번 참고)

다음

- M6 — Polar 결제 + 웹훅 (배포 전 Vercel Pro 전환)
- M7 남은 것 — `legal.ts` 값 채우기, 변호사 검토, Google OAuth 게시 신청

---

## 알아둘 제약

- **Gemini 무료 티어는 API 키 단위로 10 RPM / 1,500 RPD.** 유저별이 아니라 서비스 전체 상한이라
  동시 대화 사용자 10명 남짓이 한계다. 무료 티어 입력은 구글이 모델 학습에 쓸 수 있으므로
  개인정보처리방침에 반드시 고지해야 한다.
- **`jose`는 5.x로 고정.** 6.x는 ESM 전용이라 CommonJS로 컴파일되는 NestJS에서
  `ERR_REQUIRE_ESM`으로 죽는다. 타입체크는 통과하고 런타임에만 터진다.
- **`apps/api`의 tsconfig에 `incremental`을 켜지 말 것.** nest-cli의 `deleteOutDir`가
  dist를 지운 뒤 tsc가 "변경 없음"으로 판단해 emit을 건너뛰면 절반만 빌드된 dist가 남는다.
- **크레딧 잔액을 애플리케이션에서 계산하지 말 것.** 반드시 `spend_credits` / `grant_credits`
  RPC를 통한다. 읽고-검사하고-쓰는 코드는 동시 요청에서 잔액이 샌다.
