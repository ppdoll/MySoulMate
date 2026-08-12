'use client';

import { useEffect } from 'react';
import { rememberReferralCode } from '@/lib/referral-code';

/**
 * 초대 링크의 코드를 로그인 왕복 전에 저장해둔다.
 *
 * 화면에는 아무것도 그리지 않는다. 랜딩 페이지가 서버 컴포넌트라
 * localStorage 를 만지려면 이렇게 얇은 클라이언트 조각이 하나 필요하다.
 */
export function ReferralCatcher({ code }: { code: string }) {
  useEffect(() => {
    rememberReferralCode(code);
  }, [code]);

  return null;
}
