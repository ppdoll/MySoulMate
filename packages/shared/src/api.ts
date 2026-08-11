import { z } from 'zod';
import type { Appearance, Persona, RelationshipTone } from './persona';
import type { CreditPackCode, MissionCode } from './credits';

/**
 * web <-> api 사이의 HTTP 계약.
 *
 * 요청 본문은 zod 스키마로(api에서 런타임 검증), 응답은 순수 타입으로 둔다.
 * 응답까지 zod로 만들면 프론트에서 불필요한 파싱 비용이 든다.
 */

/** 모든 4xx/5xx 응답의 공통 형태. NestJS 예외 필터가 이 모양으로 정규화한다. */
export interface ApiErrorBody {
  /** 프론트가 분기에 쓰는 안정적인 코드. 메시지 문구는 바뀔 수 있어도 이건 유지한다. */
  code: ApiErrorCode;
  message: string;
  /** 재시도 가능한 오류일 때, 몇 초 뒤에 다시 시도하면 되는지. */
  retryAfterSeconds?: number;
}

export const API_ERROR_CODES = [
  'unauthorized',
  'forbidden',
  'not_found',
  'validation_failed',
  /** 크레딧이 모자람. 프론트는 충전 시트를 띄운다. */
  'insufficient_credits',
  /** 무료 티어 LLM이 429를 냄. 사용자에게는 "잠시 후 다시" 로 보인다. */
  'model_rate_limited',
  /** LLM/이미지 제공자 쪽 실패. 크레딧은 환불된 상태다. */
  'model_unavailable',
  /** 안전 정책에 걸린 입력. */
  'content_blocked',
  /** 이미 수령한 미션 등. */
  'already_claimed',
  'internal_error',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

// ---------------------------------------------------------------- health

export interface HealthResponse {
  status: 'ok';
  service: 'mysoulmate-api';
  /** Vercel이 주입하는 배포 커밋 SHA. 어떤 버전이 떠 있는지 확인용. */
  commit: string | null;
  timestamp: string;
}

// ---------------------------------------------------------------- wallet

export interface WalletState {
  /** 유료/보상 크레딧 잔액. credit_ledger 합계와 일치한다. */
  balance: number;
  /** 오늘 남은 무료 대화 턴. */
  freeTurnsRemaining: number;
  /** 무료 쿼터가 다시 차는 시각 (ISO 8601). */
  freeResetAt: string;
}

// ---------------------------------------------------------------- me

export interface ProfileSummary {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
  referralCode: string;
}

export interface MeResponse {
  profile: ProfileSummary;
  wallet: WalletState;
  /** 온보딩을 마쳤는지. false면 프론트는 온보딩으로 보낸다. */
  hasSoulmate: boolean;
  /**
   * 운영자 계정인지. 크레딧과 무료 쿼터 제한을 받지 않는다.
   *
   * 화면 표시용일 뿐이고 권한 판정은 서버가 토큰의 이메일로 한다.
   * 이 값을 조작해도 실제로 면제되지 않는다.
   */
  isAdmin: boolean;
}

// ---------------------------------------------------------------- soulmate

/**
 * 아바타 재생성 요청.
 * changeRequest를 비우면 "같은 인물, 다른 포즈와 옷" 으로 처리한다.
 */
export const RegenerateAvatarSchema = z.object({
  changeRequest: z.string().trim().max(200).optional(),
});

export type RegenerateAvatarRequest = z.infer<typeof RegenerateAvatarSchema>;

export interface SoulmateResponse {
  id: string;
  name: string;
  tone: RelationshipTone;
  persona: Persona;
  appearance: Appearance;
  /** Supabase Storage 서명 URL. 만료되므로 캐시하지 않는다. */
  avatarUrl: string | null;
  avatarExpiresAt: string | null;
  /**
   * 아바타가 만들어진 적이 있는지.
   *
   * avatarUrl이 null인 이유는 두 가지다 — 아직 만든 적이 없거나, 서명 URL 발급이 실패했거나.
   * 첫 아바타는 무료라서 둘을 구분해야 버튼 문구를 맞게 띄울 수 있다.
   */
  hasAvatar: boolean;
  /**
   * 고른 프리셋 캐릭터. AI 아바타가 없으면 이걸로 그린다.
   * 프리셋은 표정별 이미지가 있어서 대화 중 감정에 따라 교체된다.
   */
  presetId: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------- missions

export interface MissionState {
  code: MissionCode;
  reward: number;
  /** 지금 수령할 수 있는지. */
  claimable: boolean;
  /** 이미 받았다면 언제 받았는지. */
  claimedAt: string | null;
}

export interface ClaimMissionResponse {
  granted: number;
  wallet: WalletState;
}

// ---------------------------------------------------------------- billing

export interface CheckoutResponse {
  /** 결제사 호스티드 체크아웃 URL. 프론트는 여기로 이동시킨다. */
  url: string;
  packCode: CreditPackCode;
}

// ---------------------------------------------------------------- chat (SSE)

/**
 * 채팅 응답은 SSE로 내린다. Vercel 서버리스에서 WebSocket은 쓸 수 없다.
 * 각 이벤트는 `data: <JSON>\n\n` 형태로 전송된다.
 */
export type ChatStreamEvent =
  /** 토큰 조각. 프론트는 이어붙인다. */
  | { type: 'delta'; text: string }
  /** 정상 종료. 확정된 메시지 id와 차감 후 잔액을 함께 준다. */
  | { type: 'done'; messageId: string; wallet: WalletState }
  /** 스트림 도중 실패. 크레딧은 이미 환불된 상태다. */
  | { type: 'error'; code: ApiErrorCode; message: string; retryAfterSeconds?: number };

export interface ChatMessageDto {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export const SendMessageSchema = z.object({
  text: z.string().trim().min(1).max(1000),
});

export type SendMessageRequest = z.infer<typeof SendMessageSchema>;

export interface ChatHistoryResponse {
  /** 오래된 것부터 정렬. 화면에 그대로 이어붙이면 된다. */
  messages: ChatMessageDto[];
  /** 더 위로 불러올 게 남았는지. */
  hasMore: boolean;
  /**
   * 다음 페이지를 요청할 때 `?before=` 로 그대로 돌려보내는 값.
   *
   * 내용은 서버 사정이므로 클라이언트가 해석하지 않는다.
   * (시각으로 페이지를 나누면 같은 순간에 저장된 메시지에서 누락이나 중복이 생긴다)
   */
  nextCursor: string | null;
}
