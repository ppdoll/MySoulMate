'use client';

/**
 * 초대 링크로 들어온 코드를 로그인 왕복 동안 들고 있는다.
 *
 * `/?ref=ABCD1234` 로 도착 -> 구글 로그인 -> 콜백 -> /home 이라 쿼리스트링이 중간에
 * 사라진다. 그 사이를 넘기려면 브라우저에 남겨두는 수밖에 없다.
 *
 * 자동으로 제출하지는 않는다. 코드는 계정당 한 번만 넣을 수 있어서,
 * 본인이 모르는 사이에 아무 링크로나 묶여버리면 되돌릴 방법이 없다.
 * 입력칸에 채워만 두고 누를지는 사용자가 정한다.
 */
const KEY = 'msm.referral';

export function rememberReferralCode(code: string): void {
  const value = code.trim().toUpperCase().slice(0, 16);
  if (!value) return;
  try {
    window.localStorage.setItem(KEY, value);
  } catch {
    // 시크릿 모드나 저장소 차단. 초대 코드를 못 들고 갈 뿐 로그인은 정상이다.
  }
}

export function takeReferralCode(): string | null {
  try {
    const value = window.localStorage.getItem(KEY);
    if (value) window.localStorage.removeItem(KEY);
    return value;
  } catch {
    return null;
  }
}
