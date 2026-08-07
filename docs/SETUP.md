# 초기 설정 가이드

Supabase 프로젝트 생성 → 마이그레이션 적용 → Google 로그인 연결까지.
처음부터 끝까지 따라 하면 로컬에서 구글 로그인이 되는 상태가 된다. 대략 30~40분.

준비물: [Supabase 계정](https://supabase.com/dashboard), [Google Cloud 계정](https://console.cloud.google.com/)

> 아래 Supabase 링크의 `_` 는 "마지막에 열었던 프로젝트"를 뜻한다.
> 프로젝트가 여러 개면 링크를 연 뒤 상단에서 프로젝트를 맞게 골라야 한다.

---

## 1. Supabase 프로젝트 만들기

무료 플랜은 프로젝트 **2개**까지다. **dev / prod 하나씩** 만들고 그 이상은 만들지 않는다.
아래 과정을 두 프로젝트에 각각 한 번씩 반복한다(먼저 dev부터 끝내고 확인한 뒤 prod).

1. [supabase.com/dashboard/projects](https://supabase.com/dashboard/projects) → **New project**
2. 입력값
   - **Name**: `mysoulmate-dev` (prod는 `mysoulmate-prod`)
   - **Database Password**: 생성기로 만들어 비밀번호 관리자에 저장.
     지금 안 적어두면 나중에 재설정해야 한다
   - **Region**: `Northeast Asia (Seoul)` — 한국 사용자 기준으로 왕복 지연이 가장 짧다
3. **Create new project** → 프로비저닝에 1~2분

### 값 3개 받아두기

3단계에서 `.env`에 넣을 값들이다.

**Project URL** — [Settings › Data API](https://supabase.com/dashboard/project/_/settings/api)
에서 복사한다. `https://<project-ref>.supabase.co` 형태다.

**API 키 2개** — [Settings › API Keys](https://supabase.com/dashboard/project/_/settings/api-keys).
여기서 헷갈리기 쉬운데, **새 키는 기본으로 만들어져 있지 않다.** 직접 생성해야 나타난다.

1. 페이지에 **API Keys** / **Legacy API Keys** 두 탭이 있다
2. **API Keys** 탭에서 **Create new API Keys** 클릭
3. 생성되는 값
   - **Publishable key** → `sb_publishable_...`
   - **Secret keys** → `sb_secret_...`

> **secret key는 생성 직후 한 번만 전체가 보이는 경우가 많다.** 나오는 즉시 `apps/api/.env`에 붙여넣는다.
> 놓치면 새로 만들어야 한다.

- **secret key는 RLS를 전부 우회한다.** 프론트 코드나 저장소에 절대 올리지 않는다.
  노출했다면 같은 페이지에서 바로 폐기하고 새로 만든다.
- 새 키를 만들기 번거로우면 **Legacy API Keys** 탭의 `anon` / `service_role` 을 써도 코드는 그대로 동작한다.
  값을 문자열로 넘길 뿐이라 형식을 가리지 않는다.
  다만 [2026년 말 폐기 예정](https://supabase.com/docs/guides/api/api-keys)이라 나중에 갈아끼워야 한다
  (그때도 값만 바꾸면 되고 코드는 손댈 게 없다).

| 넣을 곳 | 새 키 | legacy 키 |
| --- | --- | --- |
| `apps/web/.env.local` → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_...` | `anon` |
| `apps/api/.env` → `SUPABASE_SECRET_KEY` | `sb_secret_...` | `service_role` |

---

## 2. 마이그레이션 적용

두 파일을 **순서대로** 실행한다. 순서를 바꾸면 두 번째 파일이 참조하는 테이블이 없어 실패한다.

1. [SQL Editor › New query](https://supabase.com/dashboard/project/_/sql/new) 열기
2. [`supabase/migrations/20260806000100_init_schema.sql`](../supabase/migrations/20260806000100_init_schema.sql)
   전체를 붙여넣고 **Run**
3. 새 쿼리 탭에서
   [`supabase/migrations/20260806000200_credit_functions.sql`](../supabase/migrations/20260806000200_credit_functions.sql)
   전체를 붙여넣고 **Run**

Supabase CLI를 쓴다면(원격 push는 Docker가 필요 없다):

```bash
supabase link --project-ref <your-project-ref> && supabase db push
```

### 잘 됐는지 확인

SQL Editor에서:

```sql
select public.next_quota_reset();
select count(*) as broken from public.audit_wallet_integrity();
select count(*) as tables from pg_tables where schemaname = 'public';
```

- 첫 줄: **다음 날 00:00+09** (KST 자정)
- 둘째 줄: `broken = 0`
- 셋째 줄: `tables = 12`

`extensions.vector` 관련 오류가 나면 그 프로젝트는 pgvector가 `public`에 설치된 것이다.
`memories.embedding` 컬럼 타입을 `extensions.vector(768)` → `vector(768)` 로 바꿔 다시 실행한다.

> 로컬에서 미리 검증하고 싶으면 `wsl bash supabase/test/run.sh` — 자세한 내용은 [README](../README.md#마이그레이션--크레딧-동시성-테스트-wsl).

---

## 3. 환경변수 채우기

```bash
cp apps/api/.env.example apps/api/.env
```

```bash
cp apps/web/.env.example apps/web/.env.local
```

1단계에서 복사해둔 값을 넣는다.

| 파일 | 키 | 값 |
| --- | --- | --- |
| `apps/api/.env` | `SUPABASE_URL` | Project URL |
| | `SUPABASE_SECRET_KEY` | `sb_secret_...` |
| | `WEB_ORIGIN` | `http://localhost:3000` |
| `apps/web/.env.local` | `NEXT_PUBLIC_SUPABASE_URL` | Project URL (같은 값) |
| | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_...` |
| | `NEXT_PUBLIC_API_URL` | `http://localhost:3001` |

`SUPABASE_JWT_SECRET`은 **비워둔다.** 요즘 만든 프로젝트는 비대칭(ES256) 서명 키를 쓰고
API가 JWKS로 검증한다. 아주 오래된 프로젝트에서 토큰 검증이 계속 실패할 때만 채운다.

---

## 4. Google 로그인 연결

세 곳을 오가며 값을 주고받는다. 순서대로 하면 헷갈리지 않는다.

```
Supabase에서 콜백 URL 복사
        ↓
Google Cloud에서 OAuth 클라이언트 생성 (콜백 URL 붙여넣기)
        ↓
Supabase에 Client ID/Secret 붙여넣기
```

### 4-1. Supabase에서 콜백 URL 복사

[Authentication › Sign In / Providers](https://supabase.com/dashboard/project/_/auth/providers) →
**Google** 을 펼치면 **Callback URL (for OAuth)** 이 있다. 복사해 둔다.

```
https://<project-ref>.supabase.co/auth/v1/callback
```

이 창은 4-3에서 다시 쓰니 탭을 닫지 않는다.

### 4-2. Google Cloud에서 OAuth 클라이언트 만들기

Google Cloud 콘솔은 2024년부터 **Google Auth Platform** 으로 개편됐다.
예전 안내에 나오는 "API 및 서비스 › OAuth 동의 화면" 메뉴는 지금 아래 항목들로 나뉘어 있다.

1. [프로젝트 만들기](https://console.cloud.google.com/projectcreate) (이미 있으면 건너뛴다)
2. [Google Auth Platform › 개요](https://console.cloud.google.com/auth/overview) →
   처음이면 **시작하기** 를 눌러 초기 설정
   - [브랜딩](https://console.cloud.google.com/auth/branding): 앱 이름, 지원 이메일.
     **여기 적는 앱 이름이 사용자에게 보이는 동의 화면 문구가 된다**
   - [대상](https://console.cloud.google.com/auth/audience): 개인 계정도 받으려면 **External**
   - [데이터 액세스](https://console.cloud.google.com/auth/scopes):
     `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile` 세 개면 충분하다
3. [클라이언트 › 클라이언트 만들기](https://console.cloud.google.com/auth/clients/create)
   - **애플리케이션 유형**: `웹 애플리케이션`
   - **승인된 JavaScript 원본**
     ```
     http://localhost:3000
     ```
     (배포 후 `https://<배포도메인>` 추가)
   - **승인된 리디렉션 URI** — 4-1에서 복사한 **Supabase 콜백 URL**
     ```
     https://<project-ref>.supabase.co/auth/v1/callback
     ```
4. **만들기** → **Client ID** 와 **Client Secret** 이 나온다

> 리디렉션 URI에 우리 앱 주소(`http://localhost:3000/auth/callback`)를 넣는 실수가 흔하다.
> 구글은 **Supabase로** 돌려보내고, Supabase가 다시 우리 앱으로 보낸다.
> 여기 들어갈 값은 항상 `supabase.co/auth/v1/callback` 이다.

### 4-3. Supabase에 붙여넣기

1. 4-1의 탭으로 돌아가 **Google** 을 켜고
   **Client ID** 와 **Client Secret** 입력 → **Save**
2. [Authentication › URL Configuration](https://supabase.com/dashboard/project/_/auth/url-configuration)
   - **Site URL**: `http://localhost:3000` (배포 후 운영 도메인으로 변경)
   - **Redirect URLs** 에 추가:
     ```
     http://localhost:3000/auth/callback
     https://<배포도메인>/auth/callback
     ```

여기 등록되지 않은 주소로는 로그인 후 되돌아오지 못한다.
Vercel 프리뷰 배포까지 쓰려면 와일드카드도 넣는다:
`https://*-<팀이름>.vercel.app/auth/callback`
([Redirect URLs 문서](https://supabase.com/docs/guides/auth/redirect-urls))

### 4-4. 테스트 사용자 등록

**대상(Audience)** 이 `테스트 중` 상태면 여기 등록한 계정만 로그인할 수 있다.
[대상 페이지](https://console.cloud.google.com/auth/audience) → **테스트 사용자** 에 본인 구글 계정을 추가한다.

`프로덕션` 으로 올리려면 개인정보처리방침·이용약관 URL이 실제로 필요하다(M7에서 처리).
그 전까지는 테스트 사용자로 충분하다.

---

## 5. 확인

```bash
pnpm install && pnpm dev
```

```bash
curl http://localhost:3001/health
```

`{"status":"ok",...}` 가 나와야 한다.

브라우저에서 `http://localhost:3000` → **구글로 계속하기** → 계정 선택 →
`/home` 에서 이름, 오늘 남은 무료 대화 **30**, 크레딧 **0**, 초대 코드 8자리가 보이면 끝이다.

DB에도 들어갔는지 확인하려면 SQL Editor에서:

```sql
select p.display_name, p.referral_code, w.balance, w.free_used_today, w.free_reset_at
  from public.profiles p
  join public.credit_wallets w on w.user_id = p.id;
```

로그인한 계정이 한 줄 나와야 한다. 이게 나오면 가입 트리거까지 정상이다.

---

## 막혔을 때

| 증상 | 원인 |
| --- | --- |
| 구글 화면에서 `redirect_uri_mismatch` | 4-2의 승인된 리디렉션 URI가 Supabase 콜백 URL과 다르다. 끝의 `/` 하나까지 같아야 한다 |
| 로그인 후 `?error=auth_failed` 로 튕김 | 4-3의 Redirect URLs에 `http://localhost:3000/auth/callback` 이 없다 |
| `/home` 에서 401 | `apps/api/.env` 의 `SUPABASE_URL` 이 web과 다른 프로젝트를 가리킨다. dev/prod를 섞어 쓴 경우가 대부분 |
| `/home` 에서 CORS 오류 | api의 `WEB_ORIGIN` 이 접속 중인 주소와 다르다. `127.0.0.1` 과 `localhost` 는 다른 오리진이다 |
| api가 부팅하다 죽음 | 환경변수 누락. 콘솔에 빠진 키 이름이 그대로 찍힌다 |
| 로그인은 되는데 `/home` 이 계속 로딩 | api가 안 떠 있다. `curl http://localhost:3001/health` 확인 |
| `Database error saving new user` | 마이그레이션 2번 파일이 적용되지 않았다. 가입 트리거가 없는 상태다 |

---

## 참고

- [Supabase — Login with Google](https://supabase.com/docs/guides/auth/social-login/auth-google)
- [Supabase — API Keys](https://supabase.com/docs/guides/api/api-keys)
- [Supabase — Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
- [Google — OAuth 동의 화면 구성](https://developers.google.com/workspace/guides/configure-oauth-consent)
- [Google — 앱 브랜딩 관리](https://support.google.com/cloud/answer/15549049?hl=ko)
