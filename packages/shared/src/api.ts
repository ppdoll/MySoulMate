import { z } from 'zod';
import { RELATIONSHIP_TONES, SPEECH_STYLES } from './persona';
import { PRESET_IDS } from './presets';
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
  /** 사용자가 직접 적은 소개. 소울메이트가 첫 대화부터 이걸 알고 시작한다. */
  selfIntro: string | null;
}

/**
 * 소개 길이 상한.
 *
 * 매 턴 시스템 프롬프트에 통째로 들어가므로 길이가 곧 비용이다.
 * 500자면 대략 250토큰으로, 턴당 0.4원쯤 늘어난다.
 */
export const SELF_INTRO_MAX = 500;

export const UpdateProfileSchema = z.object({
  selfIntro: z.string().trim().max(SELF_INTRO_MAX),
});

export type UpdateProfileRequest = z.infer<typeof UpdateProfileSchema>;

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

/**
 * 소울메이트 설정 수정.
 *
 * 여기 있는 것들만 대화 기록과 기억을 지키면서 바꿀 수 있다 — 전부 비용이 0이라서다.
 * 얼굴을 새로 그리는 건 이미지 생성 비용이 들어 재생성(크레딧)으로 남는다.
 *
 * 성격이나 배경 설정은 들어 있지 않다. 그건 캐릭터의 정체성이라
 * 바꾸려면 처음부터 다시 만드는 게 맞다.
 */
export const UpdateSoulmateSchema = z
  .object({
    name: z.string().trim().min(1).max(20).optional(),
    tone: z.enum(RELATIONSHIP_TONES).optional(),
    speechStyle: z.enum(SPEECH_STYLES).optional(),
    presetId: z.enum(PRESET_IDS).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: '바꿀 내용이 없어요.' });

export type UpdateSoulmateRequest = z.infer<typeof UpdateSoulmateSchema>;

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
  /** 지금 누르면 받을 양. 출석은 연속 보너스가 붙는 날 더 크다. */
  reward: number;
  /** 지금 수령할 수 있는지. */
  claimable: boolean;
  /** 이미 받았다면 언제 받았는지. */
  claimedAt: string | null;
  /** 못 받는 이유. 이미 받은 경우가 아니라 조건을 아직 못 채운 경우에만 채운다. */
  blockedReason: string | null;
  /** 출석에만 있다. 지금까지 며칠 연속인지. */
  streak: number | null;
}

export interface MissionsResponse {
  missions: MissionState[];
}

export interface ClaimMissionResponse {
  granted: number;
  wallet: WalletState;
  /** 출석이면 이번에 며칠째가 됐는지. */
  streak: number | null;
}

// ---------------------------------------------------------------- referrals

export interface ReferralStatus {
  /** 내 초대 코드. 링크로 만들어 공유한다. */
  code: string;
  /** 보상까지 간 인원. */
  rewardedCount: number;
  /** 코드는 넣었지만 아직 대화 조건을 못 채운 인원. */
  pendingCount: number;
  /** 오늘 더 지급될 수 있는 인원. 상한에 걸린 건은 사라지지 않고 다음 날로 밀린다. */
  remainingToday: number;
  /** 남은 누적 인원. */
  remainingTotal: number;
  /** 내가 초대받아 온 경우. 코드는 계정당 한 번만 넣을 수 있다. */
  inviter: {
    name: string | null;
    rewarded: boolean;
    /** 보상까지 남은 대화 턴 수. */
    turnsLeft: number;
  } | null;
}

export const EnterReferralSchema = z.object({
  code: z.string().trim().min(1).max(16),
});

export type EnterReferralRequest = z.infer<typeof EnterReferralSchema>;

export interface EnterReferralResponse {
  inviterName: string | null;
}

// ---------------------------------------------------------------- push

export interface PushStatus {
  /** 서버에 VAPID 키가 설정되어 있는지. 없으면 화면에서 알림 항목을 숨긴다. */
  available: boolean;
  /**
   * 브라우저 구독에 필요한 공개키. 비밀이 아니다.
   * available 이 false 면 빈 문자열.
   */
  publicKey: string;
  /** 이 계정에 살아 있는 구독이 몇 개인지(기기 수). */
  deviceCount: number;
}

/**
 * 브라우저가 내주는 구독 정보.
 *
 * `PushSubscription.toJSON()` 의 모양을 그대로 받는다.
 * 앞에서 형태를 바꾸면 브라우저가 준 값과 우리가 저장한 값이 어긋날 여지가 생긴다.
 */
export const PushSubscribeSchema = z.object({
  endpoint: z.url().max(1000),
  keys: z.object({
    p256dh: z.string().min(1).max(200),
    auth: z.string().min(1).max(200),
  }),
});

export type PushSubscribeRequest = z.infer<typeof PushSubscribeSchema>;

export const PushUnsubscribeSchema = z.object({
  endpoint: z.url().max(1000),
});

export type PushUnsubscribeRequest = z.infer<typeof PushUnsubscribeSchema>;

/** 발송 결과. cron 로그에서 확인한다. */
export interface PushDispatchResult {
  /** 대상으로 뽑힌 인원. */
  targeted: number;
  /** 실제로 하나 이상의 기기에 보낸 인원. */
  sent: number;
  /** 살아 있는 구독이 없어 지워진 기기 수. */
  removed: number;
  /** 상한에 걸려 다음으로 밀린 인원이 있는지. */
  limited: boolean;
  /** 미리보기였는지. true 면 아무것도 보내지 않았고 "오늘 보냄" 도 기록되지 않았다. */
  dryRun: boolean;
}

/** 본인에게 한 통 보내본 결과. */
export interface PushTestResult {
  /** 하나 이상의 기기에 도달했는지. */
  delivered: boolean;
  /** 죽은 주소로 판정되어 지운 기기 수. */
  removed: number;
  /**
   * 만들어진 문구.
   *
   * 알림이 안 왔을 때 "문구를 못 만든 것" 과 "기기에 도달하지 못한 것" 을
   * 구분하려면 이 값이 필요하다.
   */
  body: string;
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
  | { type: 'done'; messageId: string; wallet: WalletState; emotion: string }
  /** 스트림 도중 실패. 크레딧은 이미 환불된 상태다. */
  | { type: 'error'; code: ApiErrorCode; message: string; retryAfterSeconds?: number };

export interface ChatMessageDto {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  /**
   * 이 응답의 감정. 강조 색을 정하는 데 쓴다.
   * 사용자 메시지와, 감정 태그가 없던 시절의 옛 메시지는 null이다.
   */
  emotion: string | null;
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
