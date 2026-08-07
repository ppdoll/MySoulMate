import { Global, Injectable, Module } from '@nestjs/common';
import {
  createClient,
  type SupabaseClient,
  type SupabaseClientOptions,
} from '@supabase/supabase-js';
import { AppConfig } from '../config/app-config';

/**
 * service_role 키로 만든 Supabase 클라이언트.
 *
 * 이 키는 RLS를 전부 우회하므로 절대 프론트로 나가면 안 되고,
 * 모든 비즈니스 데이터 접근은 이 클라이언트를 통해서만 이뤄진다.
 * (테이블은 RLS deny-all로 잠가두고 브라우저의 직접 접근을 막는다)
 */
@Injectable()
export class SupabaseService {
  readonly client: SupabaseClient;

  constructor(config: AppConfig) {
    this.client = createClient(config.env.SUPABASE_URL, config.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        // 서버에서는 세션을 들고 있을 이유가 없다. 서버리스라 어차피 매번 새 인스턴스다.
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      realtime: { transport: resolveWebSocket() },
    });
  }
}

/**
 * supabase-js는 createClient 시점에 Realtime 클라이언트를 만들고,
 * 거기서 전역 WebSocket을 찾는다. 전역 WebSocket은 Node 22부터 들어왔기 때문에
 * Node 20에서는 우리가 Realtime을 전혀 쓰지 않아도 클라이언트 생성 자체가 실패한다.
 *
 * Vercel 런타임(Node 22+)에서는 전역이 있어 이 폴백을 타지 않는다.
 * 로컬 Node를 22 이상으로 올리면 ws 의존성과 이 함수를 지워도 된다.
 */
/** realtime 옵션이 요구하는 WebSocket 생성자 타입을 그대로 따라간다. */
type RealtimeTransport = NonNullable<
  NonNullable<SupabaseClientOptions<'public'>['realtime']>['transport']
>;

function resolveWebSocket(): RealtimeTransport {
  const globalWs = (globalThis as { WebSocket?: unknown }).WebSocket;
  if (globalWs) return globalWs as RealtimeTransport;

  // ws의 타입과 DOM/undici의 WebSocket 타입은 이벤트 핸들러 시그니처가 미묘하게 달라
  // 구조적으로 호환되지 않는다. 실제로 연결을 열지 않으므로 여기서만 캐스팅한다.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('ws') as unknown as RealtimeTransport;
}

@Global()
@Module({
  providers: [SupabaseService],
  exports: [SupabaseService],
})
export class SupabaseModule {}
