'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ApiError, apiFetch } from '@/lib/api';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

/**
 * 약관·처리방침 링크와 계정 삭제.
 *
 * 계정 삭제는 편의 기능이 아니라 개인정보 처리방침이 약속한 파기 경로다.
 * "회원 탈퇴 시까지 보관" 이라고 적어놓고 탈퇴할 방법을 두지 않으면 그 문장이 거짓이 된다.
 *
 * 크레딧을 받지 않는다 — 자기 정보를 지우는 데 값을 매길 수는 없다.
 */
export function AccountFooter() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function deleteAccount() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch<void>('/me', { method: 'DELETE' });
      // 계정이 사라졌으니 브라우저에 남은 세션도 정리한다.
      // 그냥 두면 만료된 토큰으로 요청하다 401 화면을 보게 된다.
      await getSupabaseBrowserClient().auth.signOut();
      router.replace('/');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '삭제하지 못했어요.');
      setBusy(false);
    }
  }

  return (
    <footer className="mt-10 border-t border-black/5 pt-5 dark:border-white/10">
      <nav className="flex gap-4 text-xs text-ink-soft/70 dark:text-cream/40">
        <Link href="/terms" className="underline-offset-2 hover:underline">
          이용약관
        </Link>
        <Link href="/privacy" className="underline-offset-2 hover:underline">
          개인정보 처리방침
        </Link>
      </nav>

      <div className="mt-4">
        {!confirming ? (
          <button
            type="button"
            onClick={() => {
              setConfirming(true);
              setError(null);
            }}
            className="text-xs text-ink-soft/70 underline-offset-4 hover:underline dark:text-cream/40"
          >
            계정 삭제
          </button>
        ) : (
          <div className="rounded-2xl border border-blush/40 p-4">
            <p className="text-sm font-medium">계정을 삭제할까요?</p>
            <p className="mt-1 text-xs leading-relaxed text-ink-soft dark:text-cream/50">
              계정과 함께 소울메이트, 지금까지 나눈 대화, 기억, 크레딧이 모두 사라져요.
              되돌릴 수 없고, 같은 구글 계정으로 다시 가입하면 처음부터 시작해요.
            </p>
            {error && <p className="mt-2 text-sm text-blush-deep">{error}</p>}
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={busy}
                className="flex-1 rounded-full border border-black/10 px-4 py-2 text-sm dark:border-white/15"
              >
                그대로 둘게요
              </button>
              <button
                type="button"
                onClick={() => void deleteAccount()}
                disabled={busy}
                className="flex-1 rounded-full bg-blush-deep px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                {busy ? '삭제 중…' : '삭제할게요'}
              </button>
            </div>
          </div>
        )}
      </div>
    </footer>
  );
}
