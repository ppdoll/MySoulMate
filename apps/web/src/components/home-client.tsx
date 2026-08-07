'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { MeResponse } from '@mysoulmate/shared';
import { ApiError, apiFetch } from '@/lib/api';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

export function HomeClient() {
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setMe(await apiFetch<MeResponse>('/me'));
    } catch (err) {
      if (err instanceof ApiError && err.code === 'unauthorized') {
        router.replace('/');
        return;
      }
      setError(err instanceof Error ? err.message : '불러오지 못했어요.');
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function signOut() {
    await getSupabaseBrowserClient().auth.signOut();
    router.replace('/');
    router.refresh();
  }

  if (error) {
    return (
      <Shell>
        <p className="text-[15px] text-blush-deep">{error}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-4 rounded-full border border-black/10 px-5 py-2 text-sm dark:border-white/15"
        >
          다시 시도
        </button>
      </Shell>
    );
  }

  if (!me) {
    return (
      <Shell>
        <p className="text-[15px] text-ink-soft dark:text-cream/60">불러오는 중…</p>
      </Shell>
    );
  }

  return (
    <Shell>
      <header className="flex items-center justify-between">
        <div>
          <p className="text-xs text-ink-soft dark:text-cream/50">반가워요</p>
          <h1 className="text-xl font-semibold">{me.profile.displayName ?? '이름 없음'}</h1>
        </div>
        <button
          type="button"
          onClick={() => void signOut()}
          className="text-sm text-ink-soft underline-offset-4 hover:underline dark:text-cream/50"
        >
          로그아웃
        </button>
      </header>

      <section className="mt-8 rounded-2xl bg-cream-deep p-5 dark:bg-night-soft">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-ink-soft dark:text-cream/60">오늘 남은 무료 대화</span>
          <span className="text-2xl font-semibold tabular-nums">
            {me.wallet.freeTurnsRemaining}
          </span>
        </div>
        <div className="mt-3 flex items-baseline justify-between">
          <span className="text-sm text-ink-soft dark:text-cream/60">크레딧</span>
          <span className="text-lg font-medium tabular-nums">{me.wallet.balance}</span>
        </div>
        <p className="mt-3 text-xs text-ink-soft/70 dark:text-cream/40">
          {formatReset(me.wallet.freeResetAt)}에 무료 대화가 다시 채워져요.
        </p>
      </section>

      <section className="mt-6">
        {me.hasSoulmate ? (
          <p className="text-[15px] text-ink-soft dark:text-cream/60">
            소울메이트가 기다리고 있어요. (대화 화면은 다음 단계에서 붙습니다)
          </p>
        ) : (
          <div className="rounded-2xl border border-dashed border-black/15 p-6 text-center dark:border-white/15">
            <p className="text-[15px]">아직 소울메이트가 없어요.</p>
            <p className="mt-1 text-sm text-ink-soft dark:text-cream/60">
              열 개의 질문에 답하면 만들어져요.
            </p>
            <button
              type="button"
              disabled
              className="mt-5 rounded-full bg-blush px-6 py-2.5 text-sm font-medium text-white disabled:opacity-50"
            >
              시작하기 (준비 중)
            </button>
          </div>
        )}
      </section>

      <footer className="mt-10 text-xs text-ink-soft/60 dark:text-cream/30">
        초대 코드 <span className="font-mono">{me.profile.referralCode}</span>
      </footer>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto w-full max-w-md px-6 py-12">{children}</main>;
}

function formatReset(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '자정';
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    timeZone: 'Asia/Seoul',
  }).format(date);
}
