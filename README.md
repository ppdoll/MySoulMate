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

---

## 1. Supabase 프로젝트 만들기

무료 플랜은 프로젝트 **2개**까지다. dev / prod 하나씩 만든다(그 이상은 만들지 않는다).

각 프로젝트에서 **SQL Editor**를 열고 아래 순서로 붙여넣어 실행한다:

1. `supabase/migrations/20260806000100_init_schema.sql`
2. `supabase/migrations/20260806000200_credit_functions.sql`

Supabase CLI를 쓴다면 이렇게 해도 된다(원격 push는 Docker가 필요 없다):

```bash
supabase link --project-ref <your-project-ref>
```

```bash
supabase db push
```

적용이 끝나면 확인:

```sql
select public.next_quota_reset();
select * from public.audit_wallet_integrity();
```

앞은 다음 KST 자정을, 뒤는 **빈 결과**를 내야 한다.

---

## 2. Google 로그인 연결

1. Google Cloud Console → **API 및 서비스 › OAuth 동의 화면** 구성
2. **사용자 인증 정보 › OAuth 클라이언트 ID**(웹 애플리케이션) 생성
3. 승인된 리디렉션 URI에 Supabase 콜백을 등록:
   `https://<project-ref>.supabase.co/auth/v1/callback`
4. 발급된 Client ID / Secret을 Supabase → **Authentication › Providers › Google**에 입력
5. Supabase → **Authentication › URL Configuration › Redirect URLs**에 추가:
   - `http://localhost:3000/auth/callback`
   - `https://<배포 도메인>/auth/callback`

> 동의 화면을 테스트에서 **게시(production)** 상태로 올리려면 개인정보처리방침·이용약관 URL이
> 실제로 필요하다. 그 전까지는 테스트 사용자로 등록한 계정만 로그인할 수 있다.

---

## 3. 환경변수

```bash
cp apps/api/.env.example apps/api/.env
```

```bash
cp apps/web/.env.example apps/web/.env.local
```

값은 Supabase → **Project Settings › API** 에서 가져온다.

| 어디 | 키 | 비고 |
| --- | --- | --- |
| api | `SUPABASE_SERVICE_ROLE_KEY` | RLS를 우회하는 키. 프론트/저장소에 절대 노출 금지 |
| api | `WEB_ORIGIN` | 쉼표로 여러 개. 프리뷰 배포 도메인도 넣어야 CORS가 통과한다 |
| web | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 공개되어도 되는 키 |
| web | `NEXT_PUBLIC_API_URL` | 로컬 `http://localhost:3001`, 배포는 api 쪽 도메인 |

`SUPABASE_JWT_SECRET`은 비워둔다. JWT signing keys(비대칭)를 쓰는 프로젝트면 JWKS로 검증하고,
레거시 HS256 프로젝트일 때만 채우면 된다.

---

## 4. 로컬 실행

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

## 5. Vercel 배포

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
저장소 Settings › Secrets에 `SUPABASE_URL`, `SUPABASE_ANON_KEY`를 등록한다.

---

## 6. 동작 확인

```bash
curl http://localhost:3001/health
```

```bash
curl -i http://localhost:3001/me
```

앞은 `{"status":"ok",...}`, 뒤는 `401 {"code":"unauthorized",...}`가 나와야 한다.

브라우저에서 `http://localhost:3000` → 구글 로그인 → `/home`에서
이름·무료 대화 잔여·크레딧·초대 코드가 보이면 M1까지 정상이다.

### 크레딧 동시성 테스트

이 프로젝트에서 가장 깨지기 쉬운 부분이다. 탭 여러 개에서 동시에 보내면
잔액이 음수가 되거나 한 번 낼 크레딧으로 두 번 쓰는 사고가 나기 쉽다.

Docker만 있으면 일회용 Postgres에 마이그레이션을 그대로 적용하고
잔액 5인 계정에 동시 차감 20건을 던져 **정확히 5건만** 통과하는지 확인한다:

```bash
bash supabase/test/run.sh
```

마지막에 `PASS: ...` 가 찍혀야 한다. 실패하면 원장 합계와 잔액이 어긋난 것이므로
`spend_credits`의 `FOR UPDATE` 잠금이 제대로 걸리는지부터 본다.

> 이 테스트는 **아직 실행되지 않았다.** 작성 시점에 로컬 Docker 엔진이 기동되지 않아
> 마이그레이션 SQL은 실제 Postgres에 적용해 검증한 적이 없다.
> Supabase 프로젝트에 붙여넣기 전에 이 스크립트를 한 번 돌리는 것을 권한다.

---

## 현재 상태

완료

- M0 — 모노레포, 두 앱 빌드/배포 구성
- M1 — DB 스키마, 크레딧 원장과 동시성 방어 함수, 구글 로그인, `GET /me`

다음

- M2 — 온보딩 10문항 → 페르소나 JSON → 아바타 생성
- M3 — SSE 채팅 + 롤링 요약
- M4 — 크레딧 차감/환불을 대화에 연결
- M5 — 미션 보상(출석·초대)
- M6 — Polar 결제 + 웹훅 (배포 전 Vercel Pro 전환)
- M7 — 약관·개인정보처리방침, Google OAuth 게시

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
