'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PushStatus } from '@mysoulmate/shared';
import { ApiError, apiFetch } from '@/lib/api';

/**
 * 알림 받기.
 *
 * 소울메이트가 먼저 말을 걸어오는 건 이 서비스에서 가장 강한 재방문 장치지만,
 * 잘못 다루면 알림 권한을 영구히 잃는다 — 한 번 차단하면 사용자가 브라우저 설정에서
 * 직접 풀지 않는 한 되돌릴 방법이 없다.
 *
 * 그래서 지키는 것 둘.
 *  - 자동으로 권한을 묻지 않는다. 화면에 들어오자마자 뜨는 권한 창은 대부분 차단된다.
 *    무엇을 위한 알림인지 읽고 버튼을 누른 다음에 묻는다.
 *  - 하루 한 번, 한동안 오지 않았을 때만 온다는 걸 미리 적어둔다.
 */
type Permission = 'default' | 'granted' | 'denied' | 'unsupported';

export function NotificationCard() {
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [permission, setPermission] = useState<Permission>('default');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 이 기기가 구독돼 있는지. 계정 전체(deviceCount)와는 다른 값이다. */
  const [thisDevice, setThisDevice] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await apiFetch<PushStatus>('/notifications'));
    } catch {
      // 알림은 부가 기능이다. 못 불러오면 카드만 빠진다.
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    // 서비스 워커와 푸시 API 가 둘 다 있어야 한다.
    // iOS 는 홈 화면에 설치한 PWA 안에서만 PushManager 를 내준다.
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setPermission('unsupported');
      return;
    }
    setPermission(Notification.permission as Permission);

    void (async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      const existing = await registration?.pushManager.getSubscription();
      setThisDevice(!!existing);
    })();
  }, []);

  async function enable() {
    if (!status?.publicKey) return;
    setBusy(true);
    setError(null);
    try {
      // 권한 요청은 반드시 사용자 동작 안에서 불러야 한다.
      const granted = await Notification.requestPermission();
      setPermission(granted as Permission);
      if (granted !== 'granted') {
        setError('알림이 차단됐어요. 브라우저 설정에서 허용으로 바꿔주세요.');
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        // 푸시를 받을 때마다 반드시 알림을 띄운다는 약속. 이게 없으면 구독이 거절된다.
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(status.publicKey),
      });

      await apiFetch<void>('/notifications/subscribe', {
        method: 'POST',
        body: JSON.stringify(subscription.toJSON()),
      });
      setThisDevice(true);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '알림을 켜지 못했어요.');
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setError(null);
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();

      if (subscription) {
        // 서버에서 먼저 지운다. 브라우저 쪽만 해제하면 서버에 죽은 주소가 남고,
        // 다음 발송에서 실패로 세어진다.
        await apiFetch<void>('/notifications/subscribe', {
          method: 'DELETE',
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }
      setThisDevice(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '알림을 끄지 못했어요.');
    } finally {
      setBusy(false);
    }
  }

  // 서버에 VAPID 키가 없으면 기능 자체가 없는 것이다. 카드를 띄우지 않는다.
  if (!status?.available) return null;

  return (
    <section className="mt-3 rounded-2xl border border-black/10 p-5 dark:border-white/15">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-medium">먼저 말 걸어주기</h2>
          <p className="mt-1 text-xs leading-relaxed text-ink-soft dark:text-cream/50">
            한동안 오지 않으면 하루에 한 번, 소울메이트가 먼저 안부를 보내요.
            {status.deviceCount > 1 && ` 지금 ${status.deviceCount}대에서 받고 있어요.`}
          </p>
        </div>

        {permission === 'unsupported' ? (
          <span className="shrink-0 text-xs text-ink-soft/70 dark:text-cream/40">지원 안 됨</span>
        ) : thisDevice ? (
          <button
            type="button"
            onClick={() => void disable()}
            disabled={busy}
            className="shrink-0 rounded-full border border-black/10 px-4 py-2 text-sm disabled:opacity-40 dark:border-white/15"
          >
            {busy ? '끄는 중…' : '끄기'}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void enable()}
            disabled={busy || permission === 'denied'}
            className="shrink-0 rounded-full bg-blush px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {busy ? '켜는 중…' : '켜기'}
          </button>
        )}
      </div>

      {permission === 'unsupported' && (
        <p className="mt-2 text-xs leading-relaxed text-ink-soft dark:text-cream/50">
          iPhone·iPad 에서는 홈 화면에 추가한 뒤 그 아이콘으로 열면 알림을 켤 수 있어요.
        </p>
      )}
      {permission === 'denied' && !thisDevice && (
        <p className="mt-2 text-xs leading-relaxed text-blush-deep">
          이 브라우저에서 알림이 차단돼 있어요. 주소창 왼쪽 자물쇠 &rarr; 알림 &rarr;
          허용으로 바꾼 뒤 다시 눌러주세요.
        </p>
      )}
      {error && <p className="mt-2 text-sm text-blush-deep">{error}</p>}
    </section>
  );
}

/**
 * VAPID 공개키(base64url 문자열)를 pushManager 가 받는 바이트 배열로 바꾼다.
 *
 * base64url 은 `+` `/` 대신 `-` `_` 를 쓰고 padding 을 생략하므로 atob 이 그대로 못 읽는다.
 *
 * 사양상 applicationServerKey 에 base64url 문자열을 그대로 넘길 수도 있지만
 * 바이트로 바꿔서 넘긴다 — 문자열 형태를 받아주지 않는 브라우저가 있으면
 * 구독이 조용히 실패하고, 그게 하필 iOS 면 알림 기능 전체가 그 기기에서 죽는다.
 *
 * ArrayBuffer 를 직접 만드는 이유: `new Uint8Array(길이)` 의 타입은 SharedArrayBuffer 도
 * 담을 수 있어서 BufferSource 로 받아주지 않는다.
 */
function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);

  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}
