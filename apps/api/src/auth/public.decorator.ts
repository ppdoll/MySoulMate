import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'mysoulmate:isPublic';

/**
 * 인증 없이 접근 가능한 엔드포인트에 붙인다.
 *
 * 가드는 전역 등록이라 기본이 "인증 필수"다. 빠뜨려서 뚫리는 것보다
 * 빠뜨려서 막히는 편이 안전하기 때문에 이 방향으로 잡았다.
 * 대상: /health, 결제 웹훅(결제사가 Bearer 토큰을 보낼 수 없다).
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
