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
