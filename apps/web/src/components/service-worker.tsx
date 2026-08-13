'use client';

import { useEffect } from 'react';

/**
 * 서비스 워커 등록.
 *
 * 화면에 아무것도 그리지 않는다. 레이아웃에 한 번만 두면 된다.
 *
 * 개발 중에는 등록하지 않는다. 워커가 살아 있으면 코드를 고쳐도 옛 응답이 섞여
 * "왜 안 바뀌지" 로 시간을 버리게 된다. 오프라인 화면과 설치 프롬프트는
 * 배포본에서만 확인한다.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;

    // 첫 화면 렌더를 워커 등록과 경쟁시키지 않는다.
    const register = () => {
      void navigator.serviceWorker.register('/sw.js').catch(() => {
        // 등록 실패는 조용히 넘긴다. 설치와 오프라인 화면만 못 쓰고 나머지는 그대로다.
      });
    };

    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);

  return null;
}
