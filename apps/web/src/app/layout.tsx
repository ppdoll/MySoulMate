import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'MySoulMate — 나만의 AI 소울메이트',
  description: '몇 가지 질문으로 나에게 맞는 성격과 모습을 가진 AI 소울메이트를 만나보세요.',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fdf8f5' },
    { media: '(prefers-color-scheme: dark)', color: '#1a1614' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
