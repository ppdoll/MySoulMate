import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ServiceWorkerRegistrar } from '@/components/service-worker';

export const metadata: Metadata = {
  title: 'MySoulMate — 나만의 AI 소울메이트',
  description: '몇 가지 질문으로 나에게 맞는 성격과 모습을 가진 AI 소울메이트를 만나보세요.',
  appleWebApp: {
    // iOS 에서 홈 화면에 추가했을 때 주소창 없이 뜨게 한다.
    capable: true,
    title: 'MySoulMate',
    // 대화 화면이 인물 사진으로 꽉 차므로 상태바를 이미지 위에 겹친다.
    statusBarStyle: 'black-translucent',
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fdf8f5' },
    { media: '(prefers-color-scheme: dark)', color: '#1a1614' },
  ],
  /*
    설치 상태에서 화면 끝까지 그린다.
    이걸 켜지 않으면 iOS 가 노치와 홈 인디케이터 자리를 비워두고 검은 띠를 남기는데,
    대화 화면이 인물로 꽉 차는 배치라 그 띠가 크게 눈에 걸린다.

    대신 화면 가장자리에 붙은 요소는 전부 env(safe-area-inset-*) 로 자리를 비켜야 한다.
    globals.css 의 .safe-* 유틸과 대화 화면의 헤더/입력바가 그걸 한다.
  */
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-dvh antialiased">
        {children}
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
