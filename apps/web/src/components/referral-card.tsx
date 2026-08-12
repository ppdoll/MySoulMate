'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  MISSION_REWARDS,
  REFERRAL_LIMITS,
  type EnterReferralResponse,
  type ReferralStatus,
} from '@mysoulmate/shared';
import { ApiError, apiFetch } from '@/lib/api';
import { takeReferralCode } from '@/lib/referral-code';

/**
 * 친구 초대.
 *
 * 보상은 초대받은 쪽이 실제로 대화를 나눈 뒤에 양쪽으로 나간다.
 * 계정만 만들어두고 크레딧을 받아가는 걸 막으려는 조건이라, 화면에서도
 * "지금 몇 턴 남았는지" 를 숨기지 않고 보여준다.
 */
export function ReferralCard() {
  const [status, setStatus] = useState<ReferralStatus | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [joined, setJoined] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await apiFetch<ReferralStatus>('/referrals'));
    } catch {
      // 초대는 부가 기능이다. 못 불러오면 카드만 빠지고 나머지는 그대로 쓴다.
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 초대 링크로 들어왔다면 코드를 입력칸에 채워둔다. 누르는 건 본인이 정한다.
  useEffect(() => {
    const saved = takeReferralCode();
    if (saved) setDraft(saved);
  }, []);

  async function enter() {
    const code = draft.trim().toUpperCase();
    if (!code) return;

    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<EnterReferralResponse>('/referrals', {
        method: 'POST',
        body: JSON.stringify({ code }),
      });
      setJoined(res.inviterName ?? '친구');
      setDraft('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '입력하지 못했어요.');
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!status) return;
    const link = `${window.location.origin}/?ref=${status.code}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError(`복사가 안 됐어요. 직접 옮겨주세요: ${link}`);
    }
  }

  if (!status) return null;

  return (
    <section className="mt-3 rounded-2xl border border-black/10 p-5 dark:border-white/15">
      <h2 className="text-sm font-medium">친구 초대</h2>
      <p className="mt-1 text-xs leading-relaxed text-ink-soft dark:text-cream/50">
        친구가 {REFERRAL_LIMITS.inviteeMinChatTurns}번 대화하면 나는{' '}
        {MISSION_REWARDS.referral_inviter}, 친구는 {MISSION_REWARDS.referral_invitee} 크레딧을
        받아요.
      </p>

      <div className="mt-3 flex items-center gap-2">
        <code className="flex-1 rounded-xl bg-cream-deep px-3 py-2.5 text-center font-mono text-lg tracking-widest dark:bg-night-soft">
          {status.code}
        </code>
        <button
          type="button"
          onClick={() => void copyLink()}
          className="shrink-0 rounded-full bg-blush px-4 py-2.5 text-sm font-medium text-white"
        >
          {copied ? '복사됨' : '링크 복사'}
        </button>
      </div>

      <div className="mt-3 flex justify-between text-xs text-ink-soft dark:text-cream/50">
        <span>
          초대 성공 {status.rewardedCount}명
          {status.pendingCount > 0 && ` · 대기 ${status.pendingCount}명`}
        </span>
        <span className="tabular-nums">
          오늘 {status.remainingToday} / 누적 {status.remainingTotal} 남음
        </span>
      </div>

      {status.remainingToday === 0 && status.pendingCount > 0 && (
        <p className="mt-2 text-xs leading-relaxed text-ink-soft dark:text-cream/50">
          오늘 한도를 다 썼어요. 남은 건 사라지지 않고 내일 지급돼요.
        </p>
      )}

      <hr className="my-4 border-black/10 dark:border-white/10" />

      {status.inviter ? (
        <p className="text-sm leading-relaxed text-ink-soft dark:text-cream/60">
          {status.inviter.name ?? '친구'}님의 초대로 시작했어요.
          {status.inviter.rewarded
            ? ' 보상은 이미 받았어요.'
            : ` ${status.inviter.turnsLeft}번 더 대화하면 둘 다 크레딧을 받아요.`}
        </p>
      ) : joined ? (
        <p className="text-sm text-blush-deep">
          {joined}님의 초대로 시작했어요. 대화를 나누면 크레딧이 들어와요.
        </p>
      ) : (
        <>
          <p className="text-sm">초대 코드를 받았나요?</p>
          <div className="mt-2 flex gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value.toUpperCase().slice(0, 16))}
              placeholder="ABCD1234"
              className="min-w-0 flex-1 rounded-xl border border-black/10 bg-white px-3 py-2.5 font-mono tracking-widest outline-none focus:border-blush dark:border-white/15 dark:bg-night-soft"
            />
            <button
              type="button"
              onClick={() => void enter()}
              disabled={busy || !draft.trim()}
              className="shrink-0 rounded-full border border-black/10 px-4 py-2.5 text-sm disabled:opacity-40 dark:border-white/15"
            >
              {busy ? '확인 중…' : '입력'}
            </button>
          </div>
          <p className="mt-1.5 text-xs text-ink-soft/70 dark:text-cream/40">
            계정당 한 번만 넣을 수 있어요.
          </p>
        </>
      )}

      {error && <p className="mt-2 text-sm text-blush-deep">{error}</p>}
    </section>
  );
}
