-- 로컬 Postgres에서 마이그레이션을 검증하기 위한 최소 스텁.
-- Supabase가 기본으로 제공하는 롤과 스키마를 흉내낸다.
-- 실제 Supabase 프로젝트에서는 절대 실행하지 않는다.

create role anon;
create role authenticated;
create role service_role;

create schema if not exists auth;
create schema if not exists extensions;
create schema if not exists storage;

-- profiles.id 가 참조하는 대상. GoTrue가 만드는 테이블의 필요한 컬럼만 흉내낸다.
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb
);

create table storage.buckets (
  id text primary key,
  name text,
  public boolean
);
