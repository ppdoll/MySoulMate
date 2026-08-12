'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  CHECKIN_STREAK,
  MISSION_META,
  type ClaimMissionResponse,
  type MissionCode,
  type MissionState,
  type MissionsResponse,
  type WalletState,
} from '@mysoulmate/shared';
import { ApiError, apiFetch } from '@/lib/api';

/**
 * 미션 보상.
 *
 * 무료 유저가 하루 30턴을 다 쓰고 나면 갈 곳이 없다. 결제가 열리기 전까지
 * 여기가 유일한 충전 경로다.
 *
 * 무료 쿼터는 매일 사라지지만 미션 보상은 쌓인다 — 며칠 모으면 아바타를
 * 다시 만들 수 있다는 게 매일 들르는 이유가 된다.
 */
export function MissionsCard({ onWallet }: { onWallet: (wallet: WalletState) => void }) {
  const [missions, setMissions] = useState<MissionState[] | null>(null);
  const [busy, setBusy] = useState<MissionCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reward, setReward] = useState<ClaimMissionResponse | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<MissionsResponse>('/missions');
      setMissions(res.missions);
    } catch {
      // 미션을 못 불러와도 홈 화면 나머지는 멀쩡해야 한다. 조용히 숨긴다.
      setMissions([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function claim(code: MissionCode) {
    setBusy(code);
    setError(null);
    try {
      const res = await apiFetch<ClaimMissionResponse>('/missions/claim', {
        method: 'POST',
        body: JSON.stringify({ code }),
      });
      setReward(res);
      onWallet(res.wallet);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '받지 못했어요.');
      // 이미 받은 경우처럼 서버 쪽 상태가 앞서 있을 수 있다. 맞춰둔다.
      await load();
    } finally {
      setBusy(null);
    }
  }

  // 받을 게 하나도 없고 기록도 없으면 카드 자체를 띄우지 않는다.
  if (!missions || missions.length === 0) return null;

  return (
    <section className="mt-6 rounded-2xl border border-black/10 p-5 dark:border-white/15">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium">크레딧 받기</h2>
        {missions.some((m) => m.claimable) && (
          <span className="rounded-full bg-blush/15 px-2 py-0.5 text-[11px] text-blush-deep">
            받을 수 있어요
          </span>
        )}
      </div>

      {reward && (
        <p className="mt-2 text-sm text-blush-deep">
          {reward.granted} 크레딧을 받았어요
          {reward.streak !== null && ` · ${reward.streak}일째`}
          {reward.streak !== null &&
            reward.streak % CHECKIN_STREAK.bonusEvery === 0 &&
            ` (연속 보너스 +${CHECKIN_STREAK.bonus})`}
        </p>
      )}
      {error && <p className="mt-2 text-sm text-blush-deep">{error}</p>}

      <ul className="mt-3 space-y-3">
        {missions.map((m) => (
          <li key={m.code} className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[15px]">
                {MISSION_META[m.code].title}
                {m.streak !== null && m.streak > 0 && (
                  <span className="ml-1.5 text-xs text-blush-deep">{m.streak}일 연속</span>
                )}
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-ink-soft dark:text-cream/50">
                {m.blockedReason ?? MISSION_META[m.code].hint}
              </p>
            </div>

            {m.claimable ? (
              <button
                type="button"
                onClick={() => void claim(m.code)}
                disabled={busy !== null}
                className="shrink-0 rounded-full bg-blush px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                {busy === m.code ? '받는 중…' : `+${m.reward}`}
              </button>
            ) : (
              <span className="shrink-0 text-sm text-ink-soft/70 tabular-nums dark:text-cream/40">
                {m.claimedAt ? '받음' : `+${m.reward}`}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
