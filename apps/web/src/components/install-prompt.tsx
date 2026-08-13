'use client';

import { useEffect, useState } from 'react';

/**
 * 홈 화면에 추가.
 *
 * 브라우저마다 방식이 다르다.
 *  - Chrome / Edge / 안드로이드: `beforeinstallprompt` 이벤트를 잡아뒀다가
 *    사용자가 버튼을 눌렀을 때 그 시점에 프롬프트를 띄운다.
 *  - iOS Safari: 프롬프트 API 가 없다. 공유 버튼을 눌러 직접 추가해야 해서
 *    방법을 글로 안내하는 수밖에 없다.
 *
 * 이미 설치된 상태에서는 아무것도 보여주지 않는다 — 설치한 사람에게
 * "설치하세요" 가 계속 떠 있는 건 그 자체로 고장처럼 보인다.
 */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function InstallPrompt() {
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(true);
  const [isIos, setIsIos] = useState(false);
  const [showIosGuide, setShowIosGuide] = useState(false);

  useEffect(() => {
    // display-mode 로 설치 여부를 판단한다. iOS 는 navigator.standalone 을 쓴다.
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    setInstalled(standalone);

    // iOS 판별. 아이패드는 데스크톱 UA 를 쓰므로 터치 여부를 함께 본다.
    const ua = navigator.userAgent;
    const iosLike =
      /iPad|iPhone|iPod/.test(ua) ||
      (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
    setIsIos(iosLike && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua));

    function onBeforeInstall(event: Event) {
      // 기본 배너를 막고 우리 버튼으로 옮긴다.
      event.preventDefault();
      setPromptEvent(event as InstallPromptEvent);
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', () => setInstalled(true));
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall);
  }, []);

  async function install() {
    if (!promptEvent) return;
    await promptEvent.prompt();
    const { outcome } = await promptEvent.userChoice;
    // 프롬프트는 한 번 쓰면 다시 못 쓴다. 거절했다면 이벤트를 버려 버튼을 감춘다.
    setPromptEvent(null);
    if (outcome === 'accepted') setInstalled(true);
  }

  if (installed) return null;

  // 안드로이드/데스크톱: 이벤트가 왔을 때만 버튼을 띄운다.
  if (promptEvent) {
    return (
      <Card>
        <Text>홈 화면에 추가하면 앱처럼 바로 열 수 있어요.</Text>
        <button
          type="button"
          onClick={() => void install()}
          className="shrink-0 rounded-full bg-blush px-4 py-2 text-sm font-medium text-white"
        >
          추가
        </button>
      </Card>
    );
  }

  if (!isIos) return null;

  // iOS: 프롬프트가 없어서 경로를 알려주는 것 말고는 방법이 없다.
  return (
    <Card column>
      <div className="flex w-full items-center gap-3">
        <Text>홈 화면에 추가하면 앱처럼 바로 열 수 있어요.</Text>
        <button
          type="button"
          onClick={() => setShowIosGuide((v) => !v)}
          className="shrink-0 rounded-full border border-black/10 px-4 py-2 text-sm dark:border-white/15"
        >
          {showIosGuide ? '닫기' : '방법'}
        </button>
      </div>
      {showIosGuide && (
        <ol className="mt-3 w-full list-decimal space-y-1 pl-5 text-xs leading-relaxed text-ink-soft dark:text-cream/60">
          <li>주소창 옆 공유 버튼을 누르세요.</li>
          <li>목록을 내려 &lsquo;홈 화면에 추가&rsquo;를 고르세요.</li>
          <li>오른쪽 위 &lsquo;추가&rsquo;를 누르면 끝이에요.</li>
        </ol>
      )}
    </Card>
  );
}

function Card({ children, column }: { children: React.ReactNode; column?: boolean }) {
  return (
    <section
      className={`mt-3 flex rounded-2xl border border-black/10 p-4 dark:border-white/15 ${
        column ? 'flex-col' : 'items-center gap-3'
      }`}
    >
      {children}
    </section>
  );
}

function Text({ children }: { children: React.ReactNode }) {
  return (
    <p className="min-w-0 flex-1 text-sm leading-relaxed text-ink-soft dark:text-cream/60">
      {children}
    </p>
  );
}
