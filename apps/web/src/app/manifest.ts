import type { MetadataRoute } from 'next';

/**
 * 웹 앱 매니페스트.
 *
 * 이게 있으면 홈 화면에 설치해서 주소창 없이 실행할 수 있다.
 * 매일 들르는 서비스라 브라우저 탭보다 아이콘으로 여는 편이 자연스럽다.
 *
 * start_url 을 `/home` 으로 두는 이유: 설치한 사람은 이미 가입한 사람이다.
 * 랜딩(`/`)으로 열면 로그인 화면이 잠깐 스쳤다가 넘어간다.
 * 로그인이 풀린 상태면 서버가 `/` 로 되돌려주므로 잘못 걸리지 않는다.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'MySoulMate — 나만의 AI 소울메이트',
    short_name: 'MySoulMate',
    description: '나에게 맞춰 자란 단 하나의 소울메이트와 이어지는 대화.',
    lang: 'ko',
    start_url: '/home',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    // 설치 스플래시와 상태바에 쓰인다. globals.css 의 --color-cream / blush 와 같은 값.
    background_color: '#fdf8f5',
    theme_color: '#d98c8c',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      // 안드로이드는 아이콘을 원형으로 잘라낸다. 잘려도 괜찮은 판을 따로 준다.
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: '대화하기', url: '/chat' },
      { name: '기억', url: '/memories' },
    ],
  };
}
