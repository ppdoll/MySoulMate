'use client';

import { useState } from 'react';
import Link from 'next/link';
import { LEGAL } from '@/lib/legal';
import { GoogleSignInButton } from './google-sign-in-button';

/**
 * 가입 동의.
 *
 * 이전에는 "계속하면 동의하는 것으로 봅니다" 한 줄이 버튼 아래에 있었다.
 * 구글 로그인 한 번으로 가입이 끝나는 구조라, 이용자가 무엇에 동의했는지 확인할
 * 기회가 사실상 없었다.
 *
 * 필수 항목만 둔다. 마케팅 수신 같은 선택 동의는 보낼 수단이 없어서 넣지 않았다.
 * 필수 동의를 쪼개 놓고 하나라도 빼면 가입이 안 되는 건 형식적이지만, 무엇에
 * 동의했는지가 화면에 남는 것 자체가 이 절차의 목적이다.
 */
const ITEMS = [
  {
    key: 'terms',
    label: '이용약관에 동의합니다',
    href: '/terms',
    linkText: '전문 보기',
  },
  {
    key: 'privacy',
    label: '개인정보 처리방침에 동의합니다',
    href: '/privacy',
    linkText: '전문 보기',
  },
  {
    key: 'age',
    label: `만 ${LEGAL.minimumAge}세 이상입니다`,
  },
  {
    key: 'ai',
    label: '대화 내용이 응답 생성을 위해 Google에 전송되고, 무료 등급에서는 Google의 모델 품질 개선에 이용될 수 있음을 확인했습니다',
    href: '/privacy',
    linkText: '자세히',
  },
] as const;

type Key = (typeof ITEMS)[number]['key'];

export function ConsentGate() {
  const [checked, setChecked] = useState<Record<Key, boolean>>({
    terms: false,
    privacy: false,
    age: false,
    ai: false,
  });

  const allChecked = ITEMS.every((item) => checked[item.key]);

  function toggleAll() {
    const next = !allChecked;
    setChecked({ terms: next, privacy: next, age: next, ai: next });
  }

  return (
    <div className="w-full">
      <div className="rounded-2xl border border-black/10 p-4 text-left dark:border-white/15">
        <button
          type="button"
          onClick={toggleAll}
          className="flex w-full items-center gap-2.5 py-1.5 text-[15px] font-medium"
        >
          <Box checked={allChecked} />
          모두 확인했어요
        </button>

        <div className="mt-2 space-y-1 border-t border-black/5 pt-2 dark:border-white/10">
          {ITEMS.map((item) => (
            <div key={item.key} className="flex items-start gap-2">
              {/*
                체크박스만 누르게 두면 탭 영역이 20px 남짓이라 휴대폰에서 잘 안 눌린다.
                동의 화면은 오탭이 곧 "동의한 적 없는 동의" 가 되는 자리라
                문구까지 묶어 행 전체를 누를 수 있게 한다.
                링크는 버튼 밖으로 뺀다 — 버튼 안에 링크를 넣으면 잘못된 마크업이고,
                전문을 보려다 체크가 토글된다.
              */}
              <button
                type="button"
                onClick={() => setChecked((prev) => ({ ...prev, [item.key]: !prev[item.key] }))}
                aria-label={item.label}
                aria-pressed={checked[item.key]}
                className="flex flex-1 items-start gap-2.5 py-2 text-left"
              >
                <span className="mt-px">
                  <Box checked={checked[item.key]} />
                </span>
                <span className="text-xs leading-relaxed text-ink-soft dark:text-cream/60">
                  {item.label}
                </span>
              </button>

              {'href' in item && (
                <Link
                  href={item.href}
                  className="shrink-0 py-2 text-xs whitespace-nowrap text-ink-soft/80 underline underline-offset-2 dark:text-cream/50"
                >
                  {item.linkText}
                </Link>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <GoogleSignInButton disabled={!allChecked} />
      </div>

      {!allChecked && (
        <p className="mt-2 text-center text-xs text-ink-soft/70 dark:text-cream/40">
          네 항목을 모두 확인하면 시작할 수 있어요.
        </p>
      )}
    </div>
  );
}

function Box({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-xs leading-none ${
        checked
          ? 'border-blush bg-blush text-white'
          : 'border-black/20 text-transparent dark:border-white/25'
      }`}
    >
      ✓
    </span>
  );
}
