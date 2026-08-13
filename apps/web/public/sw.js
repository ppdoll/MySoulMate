/*
  서비스 워커.

  하는 일이 딱 두 가지다.

  1. Chrome 이 설치 프롬프트를 띄우는 조건을 채운다.
     메뉴에서 설치하는 건 서비스 워커 없이도 되지만(Chrome 108 모바일 / 112 데스크톱부터),
     자동으로 뜨는 설치 배너는 여전히 fetch 핸들러가 있는 워커를 요구한다.
  2. 네트워크가 끊긴 상태에서 화면 이동을 하면 브라우저 기본 오류 대신 /offline 을 보여준다.

  **앱 셸을 캐시하지 않는다.** 의도적인 선택이다.
  JS·HTML 을 캐시해두면 배포한 뒤에도 사용자가 옛 코드를 계속 쓰게 되고, 그걸 알아채기가
  아주 어렵다. 대화가 전부 서버를 거치는 서비스라 오프라인 캐시로 얻을 것도 거의 없다.
  정적 자원 캐시는 Next.js 가 붙이는 HTTP 헤더에 맡긴다.
*/
const OFFLINE_URL = '/offline';
const CACHE = 'msm-offline-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.add(new Request(OFFLINE_URL, { cache: 'reload' }))),
  );
  // 새 워커를 기다리지 않고 바로 활성화한다. 캐시하는 게 오프라인 페이지뿐이라
  // 옛 워커와 섞여서 문제가 생길 여지가 없다.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // 이름이 바뀐 옛 캐시를 정리한다.
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  // 화면 이동만 가로챈다. API 호출이나 이미지는 그대로 흘려보낸다 —
  // 여기서 손대면 SSE 스트리밍(대화)까지 워커를 거치게 된다.
  if (event.request.mode !== 'navigate') return;

  event.respondWith(
    (async () => {
      try {
        return await fetch(event.request);
      } catch {
        const cache = await caches.open(CACHE);
        const cached = await cache.match(OFFLINE_URL);
        // 오프라인 페이지조차 없으면 브라우저 기본 오류로 넘긴다.
        return cached ?? Response.error();
      }
    })(),
  );
});
