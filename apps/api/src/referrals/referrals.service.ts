import { Injectable, Logger } from '@nestjs/common';
import {
  MISSION_REWARDS,
  REFERRAL_LIMITS,
  type EnterReferralResponse,
  type ReferralStatus,
} from '@mysoulmate/shared';
import { SupabaseService } from '../supabase/supabase.module';
import { ApiException } from '../common/api-exception';

/** 마이그레이션에서 정한 커스텀 SQLSTATE. */
const PG_CODE_NOT_FOUND = '45004';
const PG_ALREADY_USED = '45005';
const PG_SELF = '45006';

interface StatusRow {
  code: string;
  rewarded_count: number;
  pending_count: number;
  rewarded_today: number;
  inviter: { name: string | null; rewarded: boolean; turns_left: number } | null;
}

/**
 * 친구 초대.
 *
 * 크레딧을 공짜로 만들어내는 경로라 방어가 본체다. 실제 검사는 전부 DB 함수 안에 있다 —
 * 여기서 "이미 초대받았나" 를 조회하고 나서 넣으면 그 사이에 끼어들 수 있다.
 */
@Injectable()
export class ReferralsService {
  private readonly logger = new Logger(ReferralsService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async status(userId: string): Promise<ReferralStatus> {
    const { data, error } = await this.supabase.client.rpc('get_referral_status', {
      p_user: userId,
      p_min_turns: REFERRAL_LIMITS.inviteeMinChatTurns,
    });

    if (error) {
      this.logger.error(`초대 현황 조회 실패 [${error.code}] ${error.message}`);
      throw ApiException.internal();
    }

    const row = data as StatusRow;
    return {
      code: row.code,
      rewardedCount: row.rewarded_count,
      pendingCount: row.pending_count,
      remainingToday: Math.max(REFERRAL_LIMITS.perDay - row.rewarded_today, 0),
      remainingTotal: Math.max(REFERRAL_LIMITS.total - row.rewarded_count, 0),
      inviter: row.inviter
        ? {
            name: row.inviter.name,
            rewarded: row.inviter.rewarded,
            turnsLeft: row.inviter.turns_left,
          }
        : null,
    };
  }

  /** 코드 입력. 관계만 맺고 크레딧은 대화 조건을 채운 뒤에 나간다. */
  async enter(userId: string, code: string): Promise<EnterReferralResponse> {
    const { data, error } = await this.supabase.client.rpc('enter_referral_code', {
      p_invitee: userId,
      p_code: code,
    });

    if (error?.code === PG_CODE_NOT_FOUND) {
      throw ApiException.validationFailed('그런 초대 코드는 없어요.');
    }
    if (error?.code === PG_ALREADY_USED) {
      throw ApiException.alreadyClaimed('이미 초대 코드를 입력했어요. 계정당 한 번이에요.');
    }
    if (error?.code === PG_SELF) {
      throw ApiException.validationFailed('자기 코드는 넣을 수 없어요.');
    }
    if (error) {
      this.logger.error(`초대 코드 입력 실패 [${error.code}] ${error.message}`);
      throw ApiException.internal();
    }

    const row = data as { inviter_name: string | null };
    this.logger.log(`초대 코드 입력 완료 (user=${userId})`);
    return { inviterName: row.inviter_name };
  }

  /**
   * 밀린 초대 보상을 정산한다. 대화 한 턴이 끝날 때마다 부른다.
   *
   * 실패해도 대화는 성공한 것으로 둔다 — 보상은 다음 턴에 다시 시도되고,
   * 이것 때문에 대화를 막으면 크레딧만 쓰고 답을 못 받는다.
   *
   * @returns 이번에 지급된 건수. 0이면 화면을 갱신할 이유가 없다.
   */
  async settle(userId: string): Promise<number> {
    const { data, error } = await this.supabase.client.rpc('settle_referrals', {
      p_user: userId,
      p_min_turns: REFERRAL_LIMITS.inviteeMinChatTurns,
      p_inviter_reward: MISSION_REWARDS.referral_inviter,
      p_invitee_reward: MISSION_REWARDS.referral_invitee,
      p_per_day: REFERRAL_LIMITS.perDay,
      p_total: REFERRAL_LIMITS.total,
    });

    if (error) {
      this.logger.warn(`초대 보상 정산 실패 [${error.code}] ${error.message}`);
      return 0;
    }

    const paid = (data as number) ?? 0;
    if (paid > 0) this.logger.log(`초대 보상 ${paid}건 지급 (user=${userId})`);
    return paid;
  }
}
