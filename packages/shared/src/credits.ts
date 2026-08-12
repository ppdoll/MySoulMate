/**
 * 크레딧 정책.
 *
 * 무료 대화 / 유료 대화 / 아바타 재생성 / 미션 보상 / 결제를 전부 크레딧 하나로 통일한다.
 * 나중에 리워드 광고를 붙일 때도 "크레딧을 지급하는 또 하나의 소스"가 될 뿐이라
 * 과금 로직이 두 벌로 갈라지지 않는다.
 *
 * 잔액 계산은 두 갈래로 나뉜다:
 *  - 무료 일일 쿼터  -> credit_wallets.free_used_today 카운터 (원장에 남기지 않음)
 *  - 그 외 전부      -> credit_wallets.balance + credit_ledger (append-only)
 *
 * 따라서 "credit_ledger.delta 합계 == credit_wallets.balance" 가 항상 성립해야 한다.
 * 이 불변식이 깨지면 어딘가에서 원장을 우회해 잔액을 건드린 것이다.
 */

/** 행동별 크레딧 소모량. */
export const CREDIT_COSTS = {
  /** 대화 1턴(사용자 메시지 1건 + AI 응답 1건). */
  chatTurn: 1,
  /** 아바타 재생성 1회. 첫 생성은 온보딩에 포함되어 무료다. */
  avatarRegenerate: 10,
  /**
   * 소울메이트를 지우고 처음부터 다시 만들기.
   *
   * 재생성(10)보다 비싼 이유: 페르소나를 새로 만들고 첫 아바타도 다시 무료로 받게 된다.
   * 같은 값으로 두면 아바타 재생성 대신 이쪽을 반복하는 게 이득이 되어버린다.
   */
  soulmateReset: 20,
} as const;

export type CreditCostKey = keyof typeof CREDIT_COSTS;

/** 하루에 무료로 쓸 수 있는 대화 턴 수. 자정(UTC 기준 아님 — KST)에 lazy reset 된다. */
export const FREE_DAILY_CHAT_TURNS = 30;

/** 무료 쿼터 리셋 기준 시간대. 한국 사용자 기준으로 KST 자정에 리셋한다. */
export const QUOTA_RESET_TIMEZONE = 'Asia/Seoul';

/**
 * 원장에 기록되는 사유. DB의 credit_reason enum과 반드시 1:1로 일치해야 한다.
 * 값을 추가할 때는 마이그레이션도 같이 만든다.
 */
export const CREDIT_REASONS = [
  'chat_spend',
  'avatar_regenerate_spend',
  'soulmate_reset_spend',
  'mission_reward',
  'purchase',
  'refund',
  'admin_adjust',
] as const;

export type CreditReason = (typeof CREDIT_REASONS)[number];

/** 미션 보상 크레딧. 광고를 대신하는 무료 충전 경로다. */
export const MISSION_REWARDS = {
  /** 일일 출석. period_key = YYYY-MM-DD (KST). */
  daily_check_in: 5,
  /** 온보딩 완료. 계정당 1회. */
  onboarding_complete: 20,
  /** 친구를 초대한 쪽. */
  referral_inviter: 30,
  /** 초대받아 가입한 쪽. */
  referral_invitee: 15,
} as const;

export type MissionCode = keyof typeof MISSION_REWARDS;

export const MISSION_CODES = Object.keys(MISSION_REWARDS) as MissionCode[];

/**
 * 초대 어뷰징 방어.
 *
 * 크레딧이 공짜로 생기는 유일한 경로다. 구글 계정은 몇 분이면 만들 수 있어서
 * 상한이 없으면 자기가 자기를 초대해 무한히 찍어낼 수 있다.
 * (DB 쪽 방어는 supabase/migrations/20260812001400_referrals.sql 머리말에 정리해뒀다)
 */
export const REFERRAL_LIMITS = {
  /** 초대자가 하루에 보상받을 수 있는 최대 인원. 넘은 건은 다음 날로 밀린다. */
  perDay: 3,
  /** 초대자가 누적으로 보상받을 수 있는 최대 인원. */
  total: 20,
  /** 초대받은 계정이 이만큼 대화해야 양쪽에 보상이 지급된다. */
  inviteeMinChatTurns: 3,
} as const;

/**
 * 출석 연속 보너스.
 *
 * 매일 같은 양만 주면 하루 빠져도 잃는 게 없다. 연속이 끊긴다는 감각이 있어야
 * 돌아올 이유가 된다.
 *
 * 완주 한 주 = 5 x 7 + 10 = 45 크레딧. 아바타 재생성(10) 네 번쯤이라
 * 이미지 생성 비용에 직결된다. 무료 충전을 늘리거나 줄이려면 여기만 고친다.
 */
export const CHECKIN_STREAK = {
  /** 이 일수마다 보너스가 붙는다. */
  bonusEvery: 7,
  /** 그날 기본 보상에 더해 받는 양. */
  bonus: 10,
} as const;

/** 화면에 쓰는 문구. api와 web이 같은 말을 하도록 여기 둔다. */
export const MISSION_META: Record<MissionCode, { title: string; hint: string }> = {
  daily_check_in: {
    title: '오늘의 출석',
    hint: `매일 받을 수 있어요. ${CHECKIN_STREAK.bonusEvery}일 연속이면 ${CHECKIN_STREAK.bonus} 크레딧이 더 붙어요.`,
  },
  onboarding_complete: {
    title: '소울메이트 만들기',
    hint: '처음 한 번만. 마음에 안 드는 모습을 다시 만들어 볼 수 있어요.',
  },
  referral_inviter: {
    title: '친구 초대',
    hint: `친구가 ${REFERRAL_LIMITS.inviteeMinChatTurns}번 대화하면 자동으로 들어와요.`,
  },
  referral_invitee: {
    title: '초대받고 시작하기',
    hint: `${REFERRAL_LIMITS.inviteeMinChatTurns}번 대화하면 자동으로 들어와요.`,
  },
};

/**
 * 버튼을 눌러서 받는 미션.
 *
 * 초대는 빠져 있다 — 누를 게 없어서다. 조건(초대받은 쪽의 대화)이 채워지는 순간
 * 대화 처리 안에서 양쪽에 자동으로 들어간다. 화면은 ReferralCard 가 따로 맡는다.
 */
export const ACTIVE_MISSION_CODES: MissionCode[] = ['daily_check_in', 'onboarding_complete'];

/**
 * 판매 크레딧 팩.
 * `providerProductId` 는 Polar 대시보드에서 상품을 만든 뒤 환경변수로 주입한다.
 * 여기에는 코드/수량만 두고 가격의 원천은 결제사에 맡긴다 —
 * 코드에 박아둔 가격과 결제사 가격이 어긋나는 사고를 막기 위해서다.
 */
export const CREDIT_PACKS = [
  { code: 'pack_small', credits: 100, label: '가볍게' },
  { code: 'pack_medium', credits: 300, label: '넉넉하게', highlighted: true },
  { code: 'pack_large', credits: 1000, label: '오래오래' },
] as const;

export type CreditPackCode = (typeof CREDIT_PACKS)[number]['code'];

export const CREDIT_PACK_CODES = CREDIT_PACKS.map((p) => p.code) as CreditPackCode[];

export function getCreditPack(code: string) {
  return CREDIT_PACKS.find((p) => p.code === code);
}
