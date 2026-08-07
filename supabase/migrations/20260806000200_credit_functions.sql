-- 크레딧 연산과 신규 가입 처리.
--
-- 크레딧 차감을 애플리케이션에서 하지 않고 DB 함수로 밀어넣는 이유:
-- 탭 두 개에서 동시에 메시지를 보내면 "잔액 읽기 -> 검사 -> 쓰기" 사이에 끼어들어
-- 잔액이 음수가 되거나 한 번 낼 돈으로 두 번 쓰는 일이 생긴다.
-- 지갑 행을 FOR UPDATE로 잠근 뒤 검사와 갱신을 한 트랜잭션에서 끝내야 막힌다.
--
-- 아래 함수들은 SECURITY INVOKER(기본값)다. service_role은 RLS를 우회하므로 충분하고,
-- 혹시 실수로 authenticated에게 EXECUTE를 주더라도 RLS가 한 겹 더 막아준다.

-- 커스텀 SQLSTATE. API가 error.code로 분기한다.
--   45001 = 크레딧 부족
--   45002 = 이미 수령한 미션

-- ---------------------------------------------------------------- 차감

create or replace function public.spend_credits(
  p_user uuid,
  p_amount int,
  p_reason public.credit_reason,
  -- 이번 차감에 쓸 수 있는 무료 쿼터 총량. 호출자가 넘긴다.
  -- 상수를 SQL에 박아두면 packages/shared 의 FREE_DAILY_CHAT_TURNS 와 어긋날 수 있어서
  -- 단일 출처를 TS 쪽에 두고 값만 받는다. 아바타 재생성처럼 무료 쿼터가 없는 행동은 0을 넘긴다.
  p_free_allowance int default 0,
  p_ref_type text default null,
  p_ref_id uuid default null
)
returns jsonb
language plpgsql
as $$
declare
  v_balance int;
  v_free_used int;
  v_reset_at timestamptz;
  v_free_left int;
  v_free_cost int;
  v_paid_cost int;
begin
  if p_amount <= 0 then
    raise exception 'amount must be positive (got %)', p_amount using errcode = '22023';
  end if;
  if p_free_allowance < 0 then
    raise exception 'free allowance must not be negative' using errcode = '22023';
  end if;

  select balance, free_used_today, free_reset_at
    into v_balance, v_free_used, v_reset_at
    from public.credit_wallets
   where user_id = p_user
     for update;

  -- 가입 트리거가 지갑을 만들지만, 트리거 이전에 만들어진 계정을 대비해 한 번 더 챙긴다.
  if not found then
    insert into public.credit_wallets (user_id) values (p_user)
    on conflict (user_id) do nothing;

    select balance, free_used_today, free_reset_at
      into v_balance, v_free_used, v_reset_at
      from public.credit_wallets
     where user_id = p_user
       for update;

    -- 여기서도 없으면 v_balance가 NULL로 남고, 이후 비교가 전부 NULL(=거짓)이 되어
    -- 잔액 검사를 통과한 것처럼 흘러간다. 조용히 틀린 결과를 내는 대신 끊는다.
    if not found then
      raise exception 'wallet not found for %', p_user using errcode = '45003';
    end if;
  end if;

  -- 무료 쿼터 lazy reset. 리셋 시각이 지났으면 이 자리에서 되돌린다.
  if v_reset_at <= now() then
    v_free_used := 0;
    v_reset_at := public.next_quota_reset();
  end if;

  v_free_left := greatest(p_free_allowance - v_free_used, 0);
  v_free_cost := least(v_free_left, p_amount);
  v_paid_cost := p_amount - v_free_cost;

  if v_paid_cost > v_balance then
    raise exception 'insufficient_credits' using errcode = '45001';
  end if;

  update public.credit_wallets
     set balance = balance - v_paid_cost,
         free_used_today = v_free_used + v_free_cost,
         free_reset_at = v_reset_at
   where user_id = p_user
  returning balance, free_used_today, free_reset_at
       into v_balance, v_free_used, v_reset_at;

  -- 무료 쿼터 사용분은 원장에 남기지 않는다.
  -- 그래야 "credit_ledger 합계 == credit_wallets.balance" 불변식이 성립한다.
  if v_paid_cost > 0 then
    insert into public.credit_ledger (user_id, delta, reason, ref_type, ref_id)
    values (p_user, -v_paid_cost, p_reason, p_ref_type, p_ref_id);
  end if;

  -- 남은 무료 턴은 계산하지 않고 원시값만 돌려준다.
  -- 허용량(FREE_DAILY_CHAT_TURNS)의 출처가 TS이므로 뺄셈도 TS 한 곳에서만 한다.
  return jsonb_build_object(
    'free_used', v_free_cost,
    'paid_used', v_paid_cost,
    'balance', v_balance,
    'free_used_today', v_free_used,
    'free_reset_at', v_reset_at
  );
end;
$$;

-- ---------------------------------------------------------------- 환불

-- LLM 호출이 실패했을 때 되돌린다.
-- 차감을 먼저 하고 호출하는 이유는, 성공 후 차감하면 응답만 받고 끊는 걸 막을 수 없기 때문이다.
-- spend_credits가 돌려준 free_used / paid_used 를 그대로 넘긴다.
create or replace function public.refund_credits(
  p_user uuid,
  p_free int,
  p_paid int,
  p_ref_type text default null,
  p_ref_id uuid default null
)
returns jsonb
language plpgsql
as $$
declare
  v_balance int;
  v_free_used int;
  v_reset_at timestamptz;
begin
  if p_free < 0 or p_paid < 0 then
    raise exception 'refund amounts must not be negative' using errcode = '22023';
  end if;
  if p_free = 0 and p_paid = 0 then
    raise exception 'nothing to refund' using errcode = '22023';
  end if;

  select balance, free_used_today, free_reset_at
    into v_balance, v_free_used, v_reset_at
    from public.credit_wallets
   where user_id = p_user
     for update;

  if not found then
    raise exception 'wallet not found for %', p_user using errcode = '45003';
  end if;

  update public.credit_wallets
     set balance = balance + p_paid,
         -- 그 사이 쿼터 창이 넘어갔다면 이미 새 쿼터를 받았으므로 0 아래로는 내리지 않는다.
         free_used_today = greatest(free_used_today - p_free, 0)
   where user_id = p_user
  returning balance, free_used_today, free_reset_at
       into v_balance, v_free_used, v_reset_at;

  if p_paid > 0 then
    insert into public.credit_ledger (user_id, delta, reason, ref_type, ref_id)
    values (p_user, p_paid, 'refund', p_ref_type, p_ref_id);
  end if;

  return jsonb_build_object(
    'balance', v_balance,
    'free_used_today', v_free_used,
    'free_reset_at', v_reset_at
  );
end;
$$;

-- ---------------------------------------------------------------- 지급

create or replace function public.grant_credits(
  p_user uuid,
  p_amount int,
  p_reason public.credit_reason,
  p_ref_type text default null,
  p_ref_id uuid default null
)
returns jsonb
language plpgsql
as $$
declare
  v_balance int;
  v_free_used int;
  v_reset_at timestamptz;
begin
  if p_amount <= 0 then
    raise exception 'grant amount must be positive (got %)', p_amount using errcode = '22023';
  end if;

  insert into public.credit_wallets (user_id) values (p_user)
  on conflict (user_id) do nothing;

  update public.credit_wallets
     set balance = balance + p_amount
   where user_id = p_user
  returning balance, free_used_today, free_reset_at
       into v_balance, v_free_used, v_reset_at;

  insert into public.credit_ledger (user_id, delta, reason, ref_type, ref_id)
  values (p_user, p_amount, p_reason, p_ref_type, p_ref_id);

  return jsonb_build_object(
    'balance', v_balance,
    'free_used_today', v_free_used,
    'free_reset_at', v_reset_at
  );
end;
$$;

-- ---------------------------------------------------------------- 조회

-- 읽기 전용. GET 요청에서 쓰기가 일어나지 않도록 쿼터 리셋은 "가상으로만" 계산한다.
-- 실제 리셋은 다음 spend_credits 때 기록된다.
create or replace function public.get_wallet(p_user uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  v_balance int := 0;
  v_free_used int := 0;
  v_reset_at timestamptz := public.next_quota_reset();
begin
  select balance, free_used_today, free_reset_at
    into v_balance, v_free_used, v_reset_at
    from public.credit_wallets
   where user_id = p_user;

  if not found then
    return jsonb_build_object(
      'balance', 0,
      'free_used_today', 0,
      'free_reset_at', public.next_quota_reset()
    );
  end if;

  if v_reset_at <= now() then
    v_free_used := 0;
    v_reset_at := public.next_quota_reset();
  end if;

  return jsonb_build_object(
    'balance', v_balance,
    'free_used_today', v_free_used,
    'free_reset_at', v_reset_at
  );
end;
$$;

-- ---------------------------------------------------------------- 미션

-- 수령 기록 INSERT와 크레딧 지급을 한 트랜잭션에 묶는다.
-- unique(user_id, mission_code, period_key)가 중복 수령의 최종 방어선이라
-- 애플리케이션에서 "이미 받았나" 를 먼저 조회할 필요가 없다(조회-후-삽입은 경쟁 상태가 생긴다).
create or replace function public.claim_mission(
  p_user uuid,
  p_code text,
  p_period_key text,
  p_reward int
)
returns jsonb
language plpgsql
as $$
declare
  v_id uuid;
  v_wallet jsonb;
begin
  if p_reward <= 0 then
    raise exception 'mission reward must be positive' using errcode = '22023';
  end if;

  insert into public.mission_completions (user_id, mission_code, period_key, credits)
  values (p_user, p_code, p_period_key, p_reward)
  on conflict (user_id, mission_code, period_key) do nothing
  returning id into v_id;

  if v_id is null then
    raise exception 'already_claimed' using errcode = '45002';
  end if;

  v_wallet := public.grant_credits(p_user, p_reward, 'mission_reward', 'mission', v_id);

  return jsonb_build_object('granted', p_reward, 'wallet', v_wallet);
end;
$$;

-- ---------------------------------------------------------------- 가입

-- 구글 로그인으로 auth.users에 행이 생기면 프로필과 지갑을 함께 만든다.
-- SECURITY DEFINER가 필요한 유일한 함수다 — auth 스키마의 트리거에서 public에 써야 한다.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url, referral_code)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name'
    ),
    new.raw_user_meta_data ->> 'avatar_url',
    public.generate_referral_code()
  )
  on conflict (id) do nothing;

  insert into public.credit_wallets (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 트리거가 없던 시점에 만들어진 계정을 위한 보정.
-- 개발 중에 마이그레이션보다 먼저 로그인해버린 계정이 반드시 생기는데,
-- 그때마다 "프로필이 없습니다" 로 막히면 원인을 찾느라 시간을 버린다.
create or replace function public.ensure_profile(
  p_user uuid,
  p_display_name text default null,
  p_avatar_url text default null
)
returns void
language plpgsql
as $$
begin
  insert into public.profiles (id, display_name, avatar_url, referral_code)
  values (p_user, p_display_name, p_avatar_url, public.generate_referral_code())
  on conflict (id) do nothing;

  insert into public.credit_wallets (user_id)
  values (p_user)
  on conflict (user_id) do nothing;
end;
$$;

-- ---------------------------------------------------------------- 감사

-- "원장 합계 == 잔액" 불변식이 깨진 지갑을 찾는다.
-- 동시성 테스트와 운영 점검에서 이 함수가 빈 결과를 내야 정상이다.
create or replace function public.audit_wallet_integrity()
returns table (user_id uuid, balance int, ledger_sum bigint)
language sql
stable
as $$
  select w.user_id,
         w.balance,
         coalesce(sum(l.delta), 0) as ledger_sum
    from public.credit_wallets w
    left join public.credit_ledger l on l.user_id = w.user_id
   group by w.user_id, w.balance
  having w.balance <> coalesce(sum(l.delta), 0);
$$;

-- ---------------------------------------------------------------- 권한

-- Postgres는 새로 만든 함수에 PUBLIC EXECUTE를 기본으로 준다.
-- 그대로 두면 로그인한 사용자가 PostgREST RPC로 grant_credits를 직접 호출해
-- 크레딧을 무한히 만들어낼 수 있다. 반드시 회수한다.
revoke all on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
