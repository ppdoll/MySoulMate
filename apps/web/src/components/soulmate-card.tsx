'use client';

import { useState } from 'react';
import {
  CREDIT_COSTS,
  RELATIONSHIP_TONE_META,
  type SoulmateResponse,
  type WalletState,
} from '@mysoulmate/shared';
import { ApiError, apiFetch } from '@/lib/api';

export function SoulmateCard({
  soulmate,
  wallet,
  isAdmin,
  onUpdated,
  onReset,
}: {
  soulmate: SoulmateResponse;
  wallet: WalletState;
  isAdmin: boolean;
  onUpdated: (next: SoulmateResponse) => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [changeRequest, setChangeRequest] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 첫 아바타는 무료다. 온보딩 중 이미지 생성이 실패해 비어 있는 경우가 여기 해당한다.
  const isFirstAvatar = !soulmate.hasAvatar;
  const cost = isFirstAvatar ? 0 : CREDIT_COSTS.avatarRegenerate;
  const affordable = isAdmin || wallet.balance >= cost;
  const resetCost = CREDIT_COSTS.soulmateReset;
  const canReset = isAdmin || wallet.balance >= resetCost;

  async function regenerate() {
    setBusy(true);
    setError(null);
    try {
      const next = await apiFetch<SoulmateResponse>('/soulmate/avatar/regenerate', {
        method: 'POST',
        body: JSON.stringify(changeRequest.trim() ? { changeRequest: changeRequest.trim() } : {}),
      });
      onUpdated(next);
      setOpen(false);
      setChangeRequest('');
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.code === 'insufficient_credits'
            ? `크레딧이 ${cost}개 필요해요.`
            : err.message
          : '다시 그리지 못했어요.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch<void>('/soulmate', { method: 'DELETE' });
      onReset();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.code === 'insufficient_credits'
            ? `크레딧이 ${resetCost}개 필요해요.`
            : err.message
          : '지우지 못했어요.',
      );
      setBusy(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-2xl bg-cream-deep dark:bg-night-soft">
      {soulmate.avatarUrl ? (
        // 서명 URL이라 만료된다. Next의 이미지 최적화를 태우면 캐시가 꼬여서 그냥 img로 둔다.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={soulmate.avatarUrl}
          alt={`${soulmate.name}의 모습`}
          className="aspect-square w-full object-cover"
        />
      ) : (
        <div className="flex aspect-square w-full flex-col items-center justify-center gap-2 text-center">
          <span className="text-4xl">🤍</span>
          {isFirstAvatar && (
            <p className="px-6 text-sm text-ink-soft dark:text-cream/60">
              아직 모습이 없어요.
              <br />
              아래에서 만들어 주세요.
            </p>
          )}
        </div>
      )}

      <div className="p-5">
        <div className="flex items-baseline gap-2">
          <h2 className="text-lg font-semibold">{soulmate.name}</h2>
          <span className="text-xs text-ink-soft dark:text-cream/50">
            {RELATIONSHIP_TONE_META[soulmate.tone].label}
          </span>
        </div>
        <p className="mt-1 text-[15px] text-ink-soft dark:text-cream/70">
          {soulmate.persona.oneLiner}
        </p>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {soulmate.persona.traits.map((t) => (
            <span
              key={t}
              className="rounded-full bg-white px-2.5 py-1 text-xs dark:bg-white/10"
            >
              {t}
            </span>
          ))}
        </div>

        {!open ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className={`mt-5 w-full rounded-full py-2.5 text-sm ${
              isFirstAvatar
                ? 'bg-blush font-medium text-white'
                : 'border border-black/10 dark:border-white/15'
            }`}
          >
            {isFirstAvatar ? '모습 만들기 · 무료' : `모습 다시 그리기 · ${cost} 크레딧`}
          </button>
        ) : (
          <div className="mt-5 rounded-xl border border-black/10 p-4 dark:border-white/15">
            <p className="text-sm">{isFirstAvatar ? '어떤 모습이면 좋을까요?' : '어떻게 바꿔볼까요?'}</p>
            <p className="mt-1 text-xs text-ink-soft dark:text-cream/50">
              {isFirstAvatar
                ? '온보딩에서 답한 내용으로 만들어요. 더 하고 싶은 말이 있으면 적어주세요.'
                : '같은 사람은 그대로 두고 표정이나 옷차림만 바뀌어요. 비워두면 알아서 바꿔요.'}
            </p>
            <textarea
              value={changeRequest}
              onChange={(e) => setChangeRequest(e.target.value)}
              maxLength={200}
              rows={2}
              placeholder="예: 조금 더 밝게 웃는 얼굴로"
              className="mt-3 w-full resize-none rounded-lg border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-blush dark:border-white/15 dark:bg-night"
            />
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
                onClick={() => void regenerate()}
                disabled={busy || !affordable}
                className="flex-1 rounded-full bg-blush px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                {busy
                  ? '그리는 중…'
                  : isFirstAvatar || isAdmin
                    ? '만들기'
                    : affordable
                      ? `${cost} 크레딧 쓰기`
                      : '크레딧 부족'}
              </button>
            </div>
          </div>
        )}

        {/* 되돌릴 수 없는 작업이라 한 번 더 묻는다. */}
        <div className="mt-3 border-t border-black/5 pt-3 dark:border-white/10">
          {!confirmingReset ? (
            <button
              type="button"
              onClick={() => {
                setConfirmingReset(true);
                setError(null);
              }}
              className="w-full py-1.5 text-xs text-ink-soft underline-offset-4 hover:underline dark:text-cream/50"
            >
              처음부터 다시 만들기{isAdmin ? '' : ` · ${resetCost} 크레딧`}
            </button>
          ) : (
            <div className="rounded-xl border border-blush/40 p-4">
              <p className="text-sm font-medium">{soulmate.name}를 지우고 다시 만들까요?</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-soft dark:text-cream/50">
                지금까지 나눈 대화와 모습이 모두 사라져요. 되돌릴 수 없어요.
                {isAdmin ? ' (운영자 계정이라 크레딧은 들지 않아요)' : ` ${resetCost} 크레딧이 들어요.`}
              </p>
              {error && <p className="mt-2 text-sm text-blush-deep">{error}</p>}
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmingReset(false)}
                  disabled={busy}
                  className="flex-1 rounded-full border border-black/10 px-4 py-2 text-sm dark:border-white/15"
                >
                  그대로 둘게요
                </button>
                <button
                  type="button"
                  onClick={() => void reset()}
                  disabled={busy || !canReset}
                  className="flex-1 rounded-full bg-blush-deep px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
                >
                  {busy ? '지우는 중…' : canReset ? '지우고 다시' : '크레딧 부족'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
