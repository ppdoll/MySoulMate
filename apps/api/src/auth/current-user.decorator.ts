import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export interface AuthUser {
  /** auth.users.id — 우리 쪽 profiles.id와 같은 값이다. */
  id: string;
  email: string | null;
  /** 구글 프로필에서 온 값. 토큰의 user_metadata 클레임에 실려 온다. */
  name: string | null;
  avatarUrl: string | null;
  /**
   * 운영자 여부. ADMIN_EMAILS 환경변수로만 정해진다.
   * 크레딧과 무료 쿼터 제한을 받지 않는다.
   */
  isAdmin: boolean;
}

/** 요청 객체에 가드가 실어둔 사용자 정보. */
export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
  if (!req.user) {
    // 가드를 통과했다면 반드시 채워져 있다. 여기 오면 @Public()과 함께 쓴 실수다.
    throw new Error('@CurrentUser()를 @Public() 엔드포인트에서 사용했습니다.');
  }
  return req.user;
});
