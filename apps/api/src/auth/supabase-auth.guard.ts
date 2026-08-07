import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
// jose는 5.x로 고정한다. 6.x는 ESM 전용이라 CommonJS로 컴파일되는 NestJS에서
// require()가 ERR_REQUIRE_ESM으로 죽는다(타입체크는 통과하고 런타임에만 터진다).
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { AppConfig } from '../config/app-config';
import { ApiException } from '../common/api-exception';
import { IS_PUBLIC_KEY } from './public.decorator';
import type { AuthenticatedRequest } from './current-user.decorator';

/**
 * Supabase 액세스 토큰 검증 가드.
 *
 * 쿠키 대신 Bearer 토큰을 쓰는 이유: web과 api가 서로 다른 오리진이라
 * 세션 쿠키를 쓰면 SameSite/서드파티 쿠키 차단에 걸린다.
 *
 * 검증은 Supabase Auth 서버에 묻지 않고 로컬에서 한다.
 * JWKS를 한 번 받아 캐시해두고 서명만 확인하면 되므로 매 요청 왕복이 사라진다.
 * (jose의 createRemoteJWKSet이 캐시와 키 로테이션을 알아서 처리한다)
 */
@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  private readonly logger = new Logger(SupabaseAuthGuard.name);
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;
  private readonly legacySecret?: Uint8Array;

  constructor(
    private readonly reflector: Reflector,
    private readonly config: AppConfig,
  ) {
    this.jwks = createRemoteJWKSet(new URL(config.jwksUrl));

    const secret = config.env.SUPABASE_JWT_SECRET;
    if (secret) this.legacySecret = new TextEncoder().encode(secret);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractBearer(req.headers.authorization);
    if (!token) throw ApiException.unauthorized();

    const payload = await this.verify(token);
    const sub = payload.sub;
    if (!sub) throw ApiException.unauthorized('토큰에 사용자 정보가 없습니다.');

    const meta = (payload.user_metadata ?? {}) as Record<string, unknown>;
    req.user = {
      id: sub,
      email: typeof payload.email === 'string' ? payload.email : null,
      name: pickString(meta.full_name) ?? pickString(meta.name),
      avatarUrl: pickString(meta.avatar_url) ?? pickString(meta.picture),
    };
    return true;
  }

  private async verify(token: string): Promise<JWTPayload> {
    const options = {
      issuer: this.config.jwtIssuer,
      audience: 'authenticated',
    } as const;

    try {
      const { payload } = await jwtVerify(token, this.jwks, options);
      return payload;
    } catch (err) {
      // 비대칭 키로 실패했고 레거시 HS256 시크릿이 설정돼 있으면 그쪽으로 한 번 더 시도한다.
      // (JWT signing keys를 켜기 전에 만들어진 Supabase 프로젝트는 JWKS가 비어 있다)
      if (this.legacySecret) {
        try {
          const { payload } = await jwtVerify(token, this.legacySecret, options);
          return payload;
        } catch {
          /* 아래에서 공통 처리 */
        }
      }
      this.logger.debug(`토큰 검증 실패: ${err instanceof Error ? err.message : String(err)}`);
      throw ApiException.unauthorized('세션이 만료되었습니다. 다시 로그인해 주세요.');
    }
  }
}

function pickString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  if (!value || scheme?.toLowerCase() !== 'bearer') return null;
  return value.trim() || null;
}
