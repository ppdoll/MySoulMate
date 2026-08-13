-- 푸시 알림 대상 선정 검증.
--
-- 여기가 깨지면 알림이 두 번 가거나, 대화 중인 사람을 찌른다.
-- 알림은 한 번 스팸처럼 느껴지면 권한을 영구히 잃는다 — 차단하면 사용자가
-- 브라우저 설정에서 직접 풀지 않는 한 되돌릴 방법이 없다. 되돌릴 수 없는 실수다.
\set ON_ERROR_STOP on

-- 구독 있음 + 소울메이트 있음 + 오래 안 옴  -> 받아야 함
\set idle   '''00000000-0000-4000-8000-00000000003a'''
-- 구독 있음 + 방금 대화함                  -> 받지 말아야 함
\set active '''00000000-0000-4000-8000-00000000003b'''
-- 소울메이트 있음 + 구독 없음              -> 받지 말아야 함
\set nosub  '''00000000-0000-4000-8000-00000000003c'''
-- 구독 있음 + 소울메이트 없음              -> 받지 말아야 함
\set nosoul '''00000000-0000-4000-8000-00000000003d'''

insert into auth.users (id, email, raw_user_meta_data) values
  (:idle,   'idle@test.local',   '{}'::jsonb),
  (:active, 'active@test.local', '{}'::jsonb),
  (:nosub,  'nosub@test.local',  '{}'::jsonb),
  (:nosoul, 'nosoul@test.local', '{}'::jsonb);

\set appearance '''{"archetype":"calm","presentation":"feminine","vibe":"calm","presetId":"w_calm"}'''

select public.create_soulmate(:idle, '00000000-0000-4000-8000-000000000a01', '조용', 'friend',
  '{"name":"조용"}'::jsonb, :appearance::jsonb, null, null, '안녕!');
select public.create_soulmate(:active, '00000000-0000-4000-8000-000000000a02', '수다', 'friend',
  '{"name":"수다"}'::jsonb, :appearance::jsonb, null, null, '안녕!');
select public.create_soulmate(:nosub, '00000000-0000-4000-8000-000000000a03', '무구독', 'friend',
  '{"name":"무구독"}'::jsonb, :appearance::jsonb, null, null, '안녕!');

insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values
  (:idle,   'https://push.example/idle',   'k1', 'a1'),
  (:active, 'https://push.example/active', 'k2', 'a2'),
  (:nosoul, 'https://push.example/nosoul', 'k3', 'a3');

-- create_soulmate 가 첫 인사를 메시지로 넣어 last_message_at 이 방금이 된다.
-- '오래 안 온 사람' 을 만들려면 그 시각을 과거로 밀어야 한다.
update public.messages m
   set created_at = now() - interval '5 day'
 where m.conversation_id in (
   select id from public.conversations
    where soulmate_id in ('00000000-0000-4000-8000-000000000a01',
                          '00000000-0000-4000-8000-000000000a03')
 );

\echo '--- 검증: 조건을 다 갖춘 사람만 대상이 된다 ---'
do $$
declare
  v_ids uuid[];
begin
  select array_agg(user_id order by user_id)
    into v_ids
    from public.claim_push_targets(50, 20, 3);

  if v_ids is distinct from array['00000000-0000-4000-8000-00000000003a'::uuid] then
    raise exception 'FAIL: 대상이 %입니다 (조용 한 명이어야 함)', v_ids;
  end if;

  raise notice 'PASS: 대화 중인 사람·구독 없는 사람·소울메이트 없는 사람은 빠집니다';
end;
$$;

\echo '--- 검증: 미리보기는 기록을 남기지 않는다 ---'
do $$
declare
  v_preview int;
  v_dispatched int;
begin
  -- 위에서 실제 발송이 한 번 일어나 기록이 남았다. 되돌려서 다시 대상이 되게 한다.
  delete from public.push_dispatches;

  -- 미리보기를 세 번 불러도 매번 같은 대상이 나와야 한다.
  -- 여기서 기록이 남으면 테스트하려고 눌러본 것 때문에 그날 실제 알림이 사라진다.
  for i in 1..3 loop
    select count(*) into v_preview from public.claim_push_targets(50, 20, 3, true);
    if v_preview <> 1 then
      raise exception 'FAIL: %번째 미리보기에서 %명이 나왔습니다', i, v_preview;
    end if;
  end loop;

  select count(*) into v_dispatched from public.push_dispatches;
  if v_dispatched <> 0 then
    raise exception 'FAIL: 미리보기가 발송 기록 %건을 남겼습니다', v_dispatched;
  end if;

  -- 미리보기 뒤에도 실제 발송은 그대로 가능해야 한다.
  select count(*) into v_preview from public.claim_push_targets(50, 20, 3, false);
  if v_preview <> 1 then
    raise exception 'FAIL: 미리보기 후 실제 발송에서 %명이 나왔습니다', v_preview;
  end if;

  raise notice 'PASS: 미리보기는 몇 번이든 눌러도 되고, 그 뒤 실제 발송이 살아 있습니다';
end;
$$;

\echo '--- 검증: 같은 날 다시 부르면 아무도 안 나온다 ---'
do $$
declare
  v_count int;
begin
  -- cron 은 재시도될 수 있다. 여기서 새는 게 곧 알림 두 번이다.
  select count(*) into v_count from public.claim_push_targets(50, 20, 3);
  if v_count <> 0 then
    raise exception 'FAIL: 재호출에서 %명이 다시 뽑혔습니다', v_count;
  end if;

  raise notice 'PASS: 하루 한 번만 뽑힙니다';
end;
$$;

\echo '--- 검증: 다음 날이 되면 다시 대상이 된다 ---'
do $$
declare
  v_count int;
begin
  -- 어제 보낸 것으로 바꾼다.
  update public.push_dispatches
     set period_key = (((now() at time zone 'Asia/Seoul')::date) - 1)::text
   where user_id = '00000000-0000-4000-8000-00000000003a';

  select count(*) into v_count from public.claim_push_targets(50, 20, 3);
  if v_count <> 1 then
    raise exception 'FAIL: 다음 날인데 %명이 뽑혔습니다', v_count;
  end if;

  raise notice 'PASS: 날이 바뀌면 다시 받습니다';
end;
$$;

\echo '--- 검증: 실패가 쌓인 구독은 대상에서 빠진다 ---'
do $$
declare
  v_count int;
begin
  delete from public.push_dispatches
   where user_id = '00000000-0000-4000-8000-00000000003a';

  -- 죽은 주소로 매일 두드리면 푸시 서비스가 우리 서버를 제한할 수 있다.
  update public.push_subscriptions
     set failure_count = 4
   where endpoint = 'https://push.example/idle';

  select count(*) into v_count from public.claim_push_targets(50, 20, 3);
  if v_count <> 0 then
    raise exception 'FAIL: 실패가 쌓인 구독인데 %명이 뽑혔습니다', v_count;
  end if;

  raise notice 'PASS: 계속 실패하는 구독은 그만 두드립니다';
end;
$$;

\echo '--- 검증: 발송 결과 반영 (성공 / 실패 / 사라짐) ---'
do $$
declare
  v_count int;
  v_failures int;
begin
  -- 성공하면 실패 기록이 0 으로 돌아온다.
  perform public.record_push_result('https://push.example/idle', false, true);
  select failure_count into v_failures from public.push_subscriptions
   where endpoint = 'https://push.example/idle';
  if v_failures <> 0 then
    raise exception 'FAIL: 성공했는데 실패 기록이 %입니다', v_failures;
  end if;

  -- 일시적 실패는 세어둔다.
  perform public.record_push_result('https://push.example/idle', false, false);
  select failure_count into v_failures from public.push_subscriptions
   where endpoint = 'https://push.example/idle';
  if v_failures <> 1 then
    raise exception 'FAIL: 실패 기록이 %입니다', v_failures;
  end if;

  -- 404/410 은 구독이 사라진 것이다. 오류가 아니라 상태 변화라 바로 지운다.
  perform public.record_push_result('https://push.example/active', true, false);
  select count(*) into v_count from public.push_subscriptions
   where endpoint = 'https://push.example/active';
  if v_count <> 0 then
    raise exception 'FAIL: 사라진 구독이 지워지지 않았습니다';
  end if;

  raise notice 'PASS: 성공은 0 으로, 일시 실패는 누적, 사라진 구독은 삭제';
end;
$$;

\echo '--- 검증: 같은 기기로 다시 구독하면 갱신된다 ---'
do $$
declare
  v_count int;
  v_key text;
  v_failures int;
begin
  update public.push_subscriptions set failure_count = 2
   where endpoint = 'https://push.example/idle';

  perform public.upsert_push_subscription(
    '00000000-0000-4000-8000-00000000003a', 'https://push.example/idle', 'new-key', 'new-auth');

  select count(*) into v_count from public.push_subscriptions
   where endpoint = 'https://push.example/idle';
  select p256dh, failure_count into v_key, v_failures from public.push_subscriptions
   where endpoint = 'https://push.example/idle';

  -- 행이 늘어나면 같은 기기에 알림이 두 번 간다.
  if v_count <> 1 then
    raise exception 'FAIL: 같은 endpoint 로 %개 행이 생겼습니다', v_count;
  end if;
  if v_key <> 'new-key' then
    raise exception 'FAIL: 키가 갱신되지 않았습니다: %', v_key;
  end if;
  -- 다시 구독했다는 건 살아 있다는 뜻이다.
  if v_failures <> 0 then
    raise exception 'FAIL: 재구독 후에도 실패 기록이 %입니다', v_failures;
  end if;

  raise notice 'PASS: 같은 기기는 행이 늘지 않고 갱신되며 실패 기록이 초기화됩니다';
end;
$$;

\echo '--- 검증: 상한을 넘는 대상은 오래 안 온 사람부터 ---'
do $$
declare
  v_first uuid;
begin
  delete from public.push_dispatches;
  update public.push_subscriptions set failure_count = 0;

  -- nosoul 에게 소울메이트를 주고, idle 보다 더 오래된 상태로 만든다.
  perform public.create_soulmate(
    '00000000-0000-4000-8000-00000000003d', '00000000-0000-4000-8000-000000000a04',
    '더조용', 'friend', '{"name":"더조용"}'::jsonb,
    '{"archetype":"calm","presentation":"feminine","vibe":"calm","presetId":"w_calm"}'::jsonb,
    null, null, '안녕!');

  update public.messages m
     set created_at = now() - interval '30 day'
   where m.conversation_id in (
     select id from public.conversations
      where soulmate_id = '00000000-0000-4000-8000-000000000a04');

  -- 한 명만 뽑게 하면 더 오래 안 온 쪽이 먼저 나와야 한다.
  -- 이 순서가 없으면 상한에 걸릴 때 매일 같은 사람만 받는다.
  select user_id into v_first from public.claim_push_targets(1, 20, 3);

  if v_first <> '00000000-0000-4000-8000-00000000003d' then
    raise exception 'FAIL: 더 오래 안 온 사람이 먼저여야 하는데 %입니다', v_first;
  end if;

  raise notice 'PASS: 오래 안 온 사람이 먼저 뽑힙니다';
end;
$$;

\echo '--- 검증: 계정을 지우면 구독과 발송 기록도 사라진다 ---'
do $$
declare
  v_subs int;
  v_dispatches int;
begin
  delete from auth.users where id = '00000000-0000-4000-8000-00000000003a';

  select count(*) into v_subs from public.push_subscriptions
   where user_id = '00000000-0000-4000-8000-00000000003a';
  select count(*) into v_dispatches from public.push_dispatches
   where user_id = '00000000-0000-4000-8000-00000000003a';

  -- 탈퇴한 계정의 기기 주소가 남아 있으면 개인정보 처리방침과 어긋난다.
  if v_subs <> 0 or v_dispatches <> 0 then
    raise exception 'FAIL: 탈퇴 후 구독 %건 / 발송기록 %건이 남았습니다', v_subs, v_dispatches;
  end if;

  raise notice 'PASS: 탈퇴하면 구독과 발송 기록이 함께 사라집니다';
end;
$$;
