-- MySoulMate 초기 스키마
--
-- 접근 정책: 브라우저는 Supabase를 인증(로그인)에만 쓰고,
-- 비즈니스 데이터는 전부 NestJS API(service_role)를 통해서만 읽고 쓴다.
-- 그래서 모든 테이블은 RLS를 켜고 정책을 하나도 만들지 않는다(= anon/authenticated 전면 차단).
-- service_role 키는 RLS를 우회하므로 API만 통과한다.

create extension if not exists pgcrypto with schema extensions;

-- Supabase는 확장을 extensions 스키마에 두는 게 기본이다.
-- 이미 public에 설치된 프로젝트라면 아래 memories.embedding의 타입을
-- extensions.vector(768) -> vector(768) 로 바꿔야 한다.
create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------- enums

create type public.relationship_tone as enum ('friend', 'mentor', 'partner');
create type public.message_role as enum ('user', 'assistant');
create type public.purchase_status as enum ('pending', 'completed', 'refunded', 'failed');

-- packages/shared 의 CREDIT_REASONS 와 1:1로 일치해야 한다.
create type public.credit_reason as enum (
  'chat_spend',
  'avatar_regenerate_spend',
  'mission_reward',
  'purchase',
  'refund',
  'admin_adjust'
);

-- ---------------------------------------------------------------- helpers

-- 무료 쿼터가 다시 차는 시각 = 다음 KST 자정.
-- 스케줄러(cron)에 의존하지 않고 요청 시점에 만료를 판단하기 위한 기준값이다.
-- Vercel Hobby는 cron이 하루 1회로 제한돼서 스케줄러 기반 리셋은 애초에 못 쓴다.
create or replace function public.next_quota_reset(p_from timestamptz default now())
returns timestamptz
language sql
stable
as $$
  select (
    date_trunc('day', p_from at time zone 'Asia/Seoul') + interval '1 day'
  ) at time zone 'Asia/Seoul';
$$;

-- 헷갈리는 글자(0/O, 1/I/L)를 뺀 8자리 초대 코드.
create or replace function public.generate_referral_code()
returns text
language plpgsql
volatile
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  code text;
  i int;
begin
  loop
    code := '';
    for i in 1..8 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.profiles where referral_code = code);
  end loop;
  return code;
end;
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------- 사용자

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url text,
  locale text not null default 'ko',
  referral_code text not null unique,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- 소울메이트

create table public.soulmates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  tone public.relationship_tone not null,
  -- PersonaSchema (packages/shared/src/persona.ts) 형태
  persona jsonb not null,
  -- AppearanceSchema — 온보딩에서 고른 외형 입력 원본
  appearance jsonb not null,
  current_avatar_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- v1은 유저당 소울메이트 1명. 나중에 여러 명을 허용하려면 이 인덱스를 걷어낸다.
create unique index soulmates_user_id_key on public.soulmates (user_id);

create trigger soulmates_set_updated_at
  before update on public.soulmates
  for each row execute function public.set_updated_at();

create table public.soulmate_avatars (
  id uuid primary key default gen_random_uuid(),
  soulmate_id uuid not null references public.soulmates (id) on delete cascade,
  -- Supabase Storage의 avatars 버킷 내 경로. 버킷은 비공개고 API가 서명 URL을 발급한다.
  storage_path text not null,
  prompt text not null,
  -- 재생성의 원본. 같은 인물을 유지하려면 이전 이미지를 입력으로 넣어야 해서 계보를 남긴다.
  source_avatar_id uuid references public.soulmate_avatars (id) on delete set null,
  created_at timestamptz not null default now()
);

create index soulmate_avatars_soulmate_idx
  on public.soulmate_avatars (soulmate_id, created_at desc);

alter table public.soulmates
  add constraint soulmates_current_avatar_fkey
  foreign key (current_avatar_id) references public.soulmate_avatars (id) on delete set null;

-- ---------------------------------------------------------------- 대화

-- 소울메이트당 하나의 이어지는 스레드. 대화가 끊기지 않는다는 게 서비스의 전제다.
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  soulmate_id uuid not null references public.soulmates (id) on delete cascade,
  -- 오래된 대화를 압축한 롤링 요약. 시스템 프롬프트에 들어간다.
  summary text not null default '',
  summarized_upto_message_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index conversations_soulmate_id_key on public.conversations (soulmate_id);

create trigger conversations_set_updated_at
  before update on public.conversations
  for each row execute function public.set_updated_at();

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  role public.message_role not null,
  content text not null,
  -- 어떤 모델이 응답했는지. 무료/유료 티어 분리 후 품질 비교에 쓴다.
  model text,
  created_at timestamptz not null default now()
);

-- 최근 N턴 조회와 커서 페이지네이션용. id를 함께 넣어 같은 시각 삽입의 순서를 고정한다.
create index messages_conversation_recent_idx
  on public.messages (conversation_id, created_at desc, id desc);

-- 장기 기억. v1은 embedding을 채우지 않고 요약만 쓴다.
-- 컬럼을 미리 만들어두는 이유는 나중에 pgvector RAG를 붙일 때 마이그레이션을 다시 돌리지 않기 위해서다.
create table public.memories (
  id uuid primary key default gen_random_uuid(),
  soulmate_id uuid not null references public.soulmates (id) on delete cascade,
  kind text not null,
  content text not null,
  importance smallint not null default 1,
  embedding extensions.vector(768),
  created_at timestamptz not null default now()
);

create index memories_soulmate_idx on public.memories (soulmate_id, created_at desc);

-- ---------------------------------------------------------------- 크레딧

create table public.credit_wallets (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  -- 유료/보상 크레딧. credit_ledger.delta 합계와 항상 같아야 한다.
  -- check 제약은 동시성 버그에 대한 최후 방어선이다. 함수 로직이 틀려도 DB가 거부한다.
  balance int not null default 0 check (balance >= 0),
  -- 무료 일일 쿼터 사용량. 원장에는 남기지 않는다.
  free_used_today int not null default 0 check (free_used_today >= 0),
  free_reset_at timestamptz not null default public.next_quota_reset(),
  updated_at timestamptz not null default now()
);

create trigger credit_wallets_set_updated_at
  before update on public.credit_wallets
  for each row execute function public.set_updated_at();

-- append-only. UPDATE/DELETE 하지 않는다.
create table public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  delta int not null check (delta <> 0),
  reason public.credit_reason not null,
  ref_type text,
  ref_id uuid,
  created_at timestamptz not null default now()
);

create index credit_ledger_user_idx on public.credit_ledger (user_id, created_at desc);

-- ---------------------------------------------------------------- 결제

create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  provider text not null,
  provider_order_id text not null,
  pack_code text not null,
  credits int not null check (credits > 0),
  amount_cents int,
  currency text,
  status public.purchase_status not null default 'pending',
  raw jsonb,
  created_at timestamptz not null default now(),
  -- 웹훅 재전송으로 크레딧이 중복 지급되는 걸 막는 방어선 1.
  unique (provider, provider_order_id)
);

create index purchases_user_idx on public.purchases (user_id, created_at desc);

-- 방어선 2. 결제사는 같은 이벤트를 여러 번 보내는 게 정상 동작이다.
create table public.webhook_events (
  provider text not null,
  event_id text not null,
  processed_at timestamptz not null default now(),
  primary key (provider, event_id)
);

-- ---------------------------------------------------------------- 미션 / 초대

create table public.mission_completions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  mission_code text not null,
  -- 반복 미션의 주기 식별자. 일일 출석은 'YYYY-MM-DD'(KST), 1회성 미션은 'once'.
  period_key text not null,
  credits int not null,
  created_at timestamptz not null default now(),
  -- 중복 수령을 막는 최종 방어선.
  unique (user_id, mission_code, period_key)
);

create table public.referrals (
  id uuid primary key default gen_random_uuid(),
  inviter_id uuid not null references public.profiles (id) on delete cascade,
  -- 한 사람은 한 번만 초대받을 수 있다.
  invitee_id uuid not null unique references public.profiles (id) on delete cascade,
  rewarded_at timestamptz,
  created_at timestamptz not null default now(),
  -- 자기 자신을 초대해 크레딧을 만드는 경로를 DB에서 차단한다.
  constraint referrals_no_self check (inviter_id <> invitee_id)
);

create index referrals_inviter_idx on public.referrals (inviter_id, created_at desc);

-- ---------------------------------------------------------------- 스토리지

-- 비공개 버킷. 아바타는 API가 발급하는 서명 URL로만 노출한다.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------- RLS

alter table public.profiles enable row level security;
alter table public.soulmates enable row level security;
alter table public.soulmate_avatars enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.memories enable row level security;
alter table public.credit_wallets enable row level security;
alter table public.credit_ledger enable row level security;
alter table public.purchases enable row level security;
alter table public.webhook_events enable row level security;
alter table public.mission_completions enable row level security;
alter table public.referrals enable row level security;

-- 정책을 만들지 않으므로 anon/authenticated는 아무것도 못 한다.
-- 권한 자체도 회수해서 의도를 명시한다(RLS를 실수로 끄더라도 뚫리지 않도록).
revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;
