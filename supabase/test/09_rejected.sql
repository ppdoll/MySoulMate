-- 되돌려진 응답 기록 검증.
--
-- 여기서 지켜야 할 약속은 하나다: 사용자가 지운 대화가 이 테이블에 영원히 남으면 안 된다.
-- 소울메이트를 지우면(다시 만들기 포함) 함께 사라져야 한다.
\set ON_ERROR_STOP on

\set uid '''00000000-0000-4000-8000-000000000008'''
\set sid '''00000000-0000-4000-8000-0000000000c3'''

insert into auth.users (id, email, raw_user_meta_data)
values (:uid, 'rejected@test.local', '{}'::jsonb);

select public.create_soulmate(
  :uid, :sid, '기록', 'friend',
  '{"name":"기록"}'::jsonb,
  '{"archetype":"calm","presentation":"feminine","vibe":"calm","presetId":"calm"}'::jsonb,
  null, null, '안녕!'
);

insert into public.rejected_messages (soulmate_id, action, user_text, answer, emotion) values
  (:sid, 'undo',       '오늘 좀 힘들었어', '그렇군요. 힘드셨겠어요.', 'sad'),
  (:sid, 'regenerate', '주말에 뭐 할까?',  '주말 계획을 세워보세요.', 'neutral');

\echo '--- 검증: 허용되지 않는 action 은 거절 ---'
do $$
begin
  begin
    insert into public.rejected_messages (soulmate_id, action, user_text, answer)
    values ('00000000-0000-4000-8000-0000000000c3', 'like', '아무말', '아무답');
    raise exception 'FAIL: 정의되지 않은 action 이 들어갔습니다';
  exception
    when check_violation then
      raise notice 'PASS: undo / regenerate 외의 값은 거절됩니다';
  end;
end;
$$;

\echo '--- 검증: 소울메이트를 지우면 기록도 사라진다 ---'
do $$
declare
  v_before int;
  v_after int;
begin
  select count(*) into v_before
    from public.rejected_messages
   where soulmate_id = '00000000-0000-4000-8000-0000000000c3';

  if v_before <> 2 then
    raise exception 'FAIL: 기록이 2건이어야 하는데 %건입니다', v_before;
  end if;

  perform public.delete_soulmate(
    '00000000-0000-4000-8000-000000000008',
    '00000000-0000-4000-8000-0000000000c3'
  );

  select count(*) into v_after
    from public.rejected_messages
   where soulmate_id = '00000000-0000-4000-8000-0000000000c3';

  -- 사용자는 "지웠다" 고 생각한다. 진단용 기록이 살아남으면 그 약속을 어기는 것이다.
  if v_after <> 0 then
    raise exception 'FAIL: 소울메이트를 지웠는데 기록이 %건 남았습니다', v_after;
  end if;

  raise notice 'PASS: 다시 만들기 하면 되돌린 기록도 함께 사라집니다';
end;
$$;
