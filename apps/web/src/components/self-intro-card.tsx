'use client';

import { useState } from 'react';
import { SELF_INTRO_MAX } from '@mysoulmate/shared';
import { ApiError, apiFetch } from '@/lib/api';

/**
 * 사용자 소개.
 *
 * 지금까지 소울메이트가 상대에 대해 아는 건 구글 이름뿐이었다.
 * 나머지는 대화로 알아내야 하고, 기억으로 굳기 전까지는 매번 잊는다.
 * 여기 적어두면 첫 대화부터 알고 시작한다.
 */
export function SelfIntroCard({
  value,
  soulmateName,
  onSaved,
}: {
  value: string | null;
  soulmateName: string | null;
  onSaved: (next: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch<void>('/me', {
        method: 'PATCH',
        body: JSON.stringify({ selfIntro: draft }),
      });
      onSaved(draft.trim() || null);
      setOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '저장하지 못했어요.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <section className="mt-6 rounded-2xl border border-black/10 p-5 dark:border-white/15">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-medium">나에 대해</h2>
          <button
            type="button"
            onClick={() => {
              setDraft(value ?? '');
              setOpen(true);
            }}
            className="text-sm text-ink-soft underline-offset-4 hover:underline dark:text-cream/60"
          >
            {value ? '고치기' : '적기'}
          </button>
        </div>

        {value ? (
          <p className="mt-2 text-[15px] leading-relaxed whitespace-pre-wrap text-ink-soft dark:text-cream/70">
            {value}
          </p>
        ) : (
          <p className="mt-2 text-sm leading-relaxed text-ink-soft dark:text-cream/60">
            직업이나 요즘 관심사를 적어두면{soulmateName ? ` ${soulmateName}가` : ' 소울메이트가'} 첫
            대화부터 알고 있어요.
          </p>
        )}
      </section>
    );
  }

  return (
    <section className="mt-6 rounded-2xl border border-blush/40 p-5">
      <h2 className="text-sm font-medium">나에 대해</h2>
      <p className="mt-1 text-xs leading-relaxed text-ink-soft dark:text-cream/50">
        예: 30대 개발자예요. 요즘 이직 준비 중이고, 고양이 한 마리 키워요.
      </p>

      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value.slice(0, SELF_INTRO_MAX))}
        rows={4}
        placeholder="어떤 사람인지 편하게 적어주세요"
        className="mt-3 w-full resize-none rounded-xl border border-black/10 bg-white px-3 py-2.5 text-[15px] outline-none focus:border-blush dark:border-white/15 dark:bg-night-soft"
      />

      <div className="mt-1 text-right text-xs text-ink-soft/70 tabular-nums dark:text-cream/40">
        {draft.length} / {SELF_INTRO_MAX}
      </div>

      {error && <p className="mt-2 text-sm text-blush-deep">{error}</p>}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={busy}
          className="rounded-full border border-black/10 px-4 py-2 text-sm dark:border-white/15"
        >
          취소
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy}
          className="flex-1 rounded-full bg-blush px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {busy ? '저장 중…' : '저장'}
        </button>
      </div>
    </section>
  );
}
