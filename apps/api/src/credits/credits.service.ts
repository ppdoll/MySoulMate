import { Injectable, Logger } from '@nestjs/common';
import type { PostgrestError } from '@supabase/supabase-js';
import { FREE_DAILY_CHAT_TURNS, type CreditReason, type WalletState } from '@mysoulmate/shared';
import { SupabaseService } from '../supabase/supabase.module';
import { ApiException } from '../common/api-exception';

/**
 * 크레딧 연산 래퍼.
 *
 * 잔액 계산은 전부 DB 함수 안에서 일어난다. 여기서는 절대 읽고-계산하고-쓰지 않는다.
 * (동시 요청에서 잔액이 새는 고전적인 경로다)
 */

/** 마이그레이션에서 정한 커스텀 SQLSTATE. */
const PG_INSUFFICIENT_CREDITS = '45001';
const PG_ALREADY_CLAIMED = '45002';

interface WalletRow {
  balance: number;
  free_used_today: number;
  free_reset_at: string;
}

interface SpendRow extends WalletRow {
  free_used: number;
  paid_used: number;
}

export interface SpendResult {
  /** 무료 쿼터에서 나간 양. 실패 시 이 값을 그대로 환불에 넘긴다. */
  freeUsed: number;
  /** 유료 잔액에서 나간 양. */
  paidUsed: number;
  wallet: WalletState;
}

@Injectable()
export class CreditsService {
  private readonly logger = new Logger(CreditsService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async getWallet(userId: string): Promise<WalletState> {
    const { data, error } = await this.supabase.client.rpc('get_wallet', { p_user: userId });
    this.rethrow(error, 'get_wallet');
    return toWalletState(data as WalletRow);
  }

  /**
   * 크레딧을 차감한다. 무료 쿼터를 먼저 쓰고 모자란 만큼만 잔액에서 뺀다.
   *
   * @param freeAllowance 이번 차감에 쓸 수 있는 무료 쿼터. 대화는 FREE_DAILY_CHAT_TURNS,
   *                      아바타 재생성처럼 무료분이 없는 행동은 0을 넘긴다.
   */
  async spend(params: {
    userId: string;
    amount: number;
    reason: CreditReason;
    freeAllowance?: number;
    refType?: string;
    refId?: string;
    /**
     * 운영자 면제. 차감을 아예 건너뛴다.
     *
     * 호출부마다 분기하지 않고 여기서 한 번에 처리하는 이유:
     * 새 기능(대화 등)을 붙일 때 면제 처리를 빠뜨리지 않기 위해서다.
     * 원장에도 남기지 않는다 — 쓰지 않은 크레딧을 기록하면 정합성 검사가 어긋난다.
     */
    unlimited?: boolean;
  }): Promise<SpendResult> {
    if (params.unlimited) {
      this.logger.debug(`운영자 면제: ${params.reason} ${params.amount} (user=${params.userId})`);
      return {
        freeUsed: 0,
        paidUsed: 0,
        wallet: await this.getWallet(params.userId),
      };
    }

    const { data, error } = await this.supabase.client.rpc('spend_credits', {
      p_user: params.userId,
      p_amount: params.amount,
      p_reason: params.reason,
      p_free_allowance: params.freeAllowance ?? 0,
      p_ref_type: params.refType ?? null,
      p_ref_id: params.refId ?? null,
    });

    if (error?.code === PG_INSUFFICIENT_CREDITS) {
      throw ApiException.insufficientCredits();
    }
    this.rethrow(error, 'spend_credits');

    const row = data as SpendRow;
    return {
      freeUsed: row.free_used,
      paidUsed: row.paid_used,
      wallet: toWalletState(row),
    };
  }

  /**
   * 차감을 되돌린다. 모델 호출이 실패했을 때 쓴다.
   *
   * 차감을 먼저 하고 실패하면 환불하는 순서인 이유:
   * 반대로 하면(성공 후 차감) 스트림만 받고 연결을 끊어 공짜로 쓸 수 있다.
   *
   * 알려진 한계 — 차감과 환불 사이에 프로세스가 죽으면 그 크레딧은 사라진다.
   * 대화 1건당 1크레딧이라 실질 피해가 작아 v1에서는 예약 테이블을 두지 않았다.
   */
  async refund(params: {
    userId: string;
    freeUsed: number;
    paidUsed: number;
    refType?: string;
    refId?: string;
  }): Promise<void> {
    if (params.freeUsed === 0 && params.paidUsed === 0) return;

    const { error } = await this.supabase.client.rpc('refund_credits', {
      p_user: params.userId,
      p_free: params.freeUsed,
      p_paid: params.paidUsed,
      p_ref_type: params.refType ?? null,
      p_ref_id: params.refId ?? null,
    });

    if (error) {
      // 환불 실패로 요청 전체를 실패시키면 사용자는 원래 오류의 이유를 못 보게 된다.
      // 여기서는 로그만 남기고, 정합성은 audit_wallet_integrity()로 따로 잡는다.
      this.logger.error(
        `크레딧 환불 실패 user=${params.userId} free=${params.freeUsed} paid=${params.paidUsed}: ${error.message}`,
      );
    }
  }

  async grant(params: {
    userId: string;
    amount: number;
    reason: CreditReason;
    refType?: string;
    refId?: string;
  }): Promise<WalletState> {
    const { data, error } = await this.supabase.client.rpc('grant_credits', {
      p_user: params.userId,
      p_amount: params.amount,
      p_reason: params.reason,
      p_ref_type: params.refType ?? null,
      p_ref_id: params.refId ?? null,
    });
    this.rethrow(error, 'grant_credits');
    return toWalletState(data as WalletRow);
  }

  /**
   * 미션 보상 수령. 기록 삽입과 지급이 한 트랜잭션이라
   * "이미 받았는지 조회 -> 지급" 사이의 경쟁 상태가 없다.
   */
  async claimMission(params: {
    userId: string;
    code: string;
    periodKey: string;
    reward: number;
  }): Promise<{ granted: number; wallet: WalletState }> {
    const { data, error } = await this.supabase.client.rpc('claim_mission', {
      p_user: params.userId,
      p_code: params.code,
      p_period_key: params.periodKey,
      p_reward: params.reward,
    });

    if (error?.code === PG_ALREADY_CLAIMED) {
      throw ApiException.alreadyClaimed();
    }
    this.rethrow(error, 'claim_mission');

    const row = data as { granted: number; wallet: WalletRow };
    return { granted: row.granted, wallet: toWalletState(row.wallet) };
  }

  private rethrow(error: PostgrestError | null, fn: string): void {
    if (!error) return;
    this.logger.error(`${fn} 실패 [${error.code}] ${error.message}`);
    throw ApiException.internal();
  }
}

/**
 * 남은 무료 턴은 여기서만 계산한다.
 * DB는 사용량(free_used_today)만 들고 있고 허용량의 출처는 packages/shared다.
 */
function toWalletState(row: WalletRow): WalletState {
  return {
    balance: row.balance,
    freeTurnsRemaining: Math.max(FREE_DAILY_CHAT_TURNS - row.free_used_today, 0),
    freeResetAt: row.free_reset_at,
  };
}
