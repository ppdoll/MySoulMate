import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '연결이 끊겼어요 · MySoulMate',
};

/**
 * 오프라인 화면.
 *
 * 서비스 워커가 화면 이동에 실패했을 때만 보인다.
 * 다시 시도 버튼을 두지 않는다 — 네트워크가 돌아왔는지 알 수 없는 상태에서
 * 누르게 하면 같은 화면이 다시 뜬다. 새로고침이 더 정직하다.
 */
export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 text-center">
      <span className="mx-auto mb-6 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-cream-deep text-2xl dark:bg-night-soft">
        🤍
      </span>
      <h1 className="text-xl font-semibold">연결이 끊겼어요</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-ink-soft dark:text-cream/60">
        대화는 인터넷이 있어야 이어갈 수 있어요.
        <br />
        연결을 확인하고 새로고침해 주세요.
      </p>
      <p className="mt-8 text-xs text-ink-soft/70 dark:text-cream/40">
        지금까지 나눈 대화와 기억은 그대로 있어요.
      </p>
    </main>
  );
}
