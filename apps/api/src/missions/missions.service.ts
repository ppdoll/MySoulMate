import { Injectable, Logger } from '@nestjs/common';
import {
  ACTIVE_MISSION_CODES,
  CHECKIN_STREAK,
  MISSION_REWARDS,
  type ClaimMissionResponse,
  type MissionCode,
  type MissionState,
  type MissionsResponse,
} from '@mysoulmate/shared';
import { SupabaseService } from '../supabase/supabase.module';
import { CreditsService } from '../credits/credits.service';
import { ApiException } from '../common/api-exception';

/** 1회성 미션의 period_key. 마이그레이션 주석과 같은 값이어야 한다. */
const ONCE = 'once';

interface CompletionRow {
  mission_code: string;
  period_key: string;
  created_at: string;
}

/**
 * 미션 보상.
 *
 * 무료 유저는 하루 30턴을 쓰고 나면 갈 곳이 없다. 결제(M6)는 Vercel Pro 전환이
 * 선행돼야 하므로 지금은 이게 유일한 충전 경로다.
 *
 * 무료 쿼터와 달리 미션 보상은 쌓인다. 며칠 모으면 아바타를 다시 만들 수 있다.
 */
@Injectable()
export class MissionsService {
  private readonly logger = new Logger(MissionsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly credits: CreditsService,
  ) {}

  async list(userId: string): Promise<MissionsResponse> {
    const today = kstToday();

    const [checkin, completions, hasSoulmate] = await Promise.all([
      this.credits.checkinState(userId),
      this.completions(userId, today),
      this.hasSoulmate(userId),
    ]);

    const claimedAt = (code: MissionCode, periodKey: string) =>
      completions.find((c) => c.mission_code === code && c.period_key === periodKey)?.created_at ??
      null;

    // 다음에 받을 때가 며칠째가 되는지. get_checkin_state 가 끊긴 연속은 0으로 내려주므로
    // 여기서는 그냥 하나만 더하면 된다.
    const nextStreak = checkin.streak + 1;
    const bonusDay = nextStreak % CHECKIN_STREAK.bonusEvery === 0;

    const states: Record<MissionCode, MissionState> = {
      daily_check_in: {
        code: 'daily_check_in',
        reward: MISSION_REWARDS.daily_check_in + (bonusDay ? CHECKIN_STREAK.bonus : 0),
        claimable: !checkin.claimedToday,
        claimedAt: claimedAt('daily_check_in', today),
        blockedReason: null,
        streak: checkin.streak,
      },
      onboarding_complete: {
        code: 'onboarding_complete',
        reward: MISSION_REWARDS.onboarding_complete,
        claimable: hasSoulmate && claimedAt('onboarding_complete', ONCE) === null,
        claimedAt: claimedAt('onboarding_complete', ONCE),
        blockedReason: hasSoulmate ? null : '소울메이트를 먼저 만들어주세요.',
        streak: null,
      },
      // 초대는 어뷰징 방어(하루 3명 / 누적 20명 / 초대받은 쪽 최소 활동)를 붙인 뒤에 연다.
      // 목록에는 나오지 않는다 — ACTIVE_MISSION_CODES 가 걸러낸다.
      referral_inviter: notYet('referral_inviter'),
      referral_invitee: notYet('referral_invitee'),
    };

    return { missions: ACTIVE_MISSION_CODES.map((code) => states[code]) };
  }

  async claim(userId: string, code: MissionCode): Promise<ClaimMissionResponse> {
    if (!ACTIVE_MISSION_CODES.includes(code)) {
      throw ApiException.validationFailed('아직 열리지 않은 미션이에요.');
    }

    if (code === 'daily_check_in') {
      const result = await this.credits.claimDailyCheckin(userId);
      this.logger.log(`출석 ${result.streak}일째, ${result.granted} 지급 (user=${userId})`);
      return result;
    }

    // onboarding_complete. 소울메이트가 있어야 받을 수 있다.
    if (!(await this.hasSoulmate(userId))) {
      throw ApiException.validationFailed('소울메이트를 먼저 만들어주세요.');
    }

    const result = await this.credits.claimMission({
      userId,
      code,
      periodKey: ONCE,
      reward: MISSION_REWARDS[code],
    });
    return { ...result, streak: null };
  }

  /**
   * 오늘과 1회성 미션의 수령 기록만 가져온다.
   * 전체를 읽으면 하루 한 줄씩 늘어나는 표를 매번 통째로 훑게 된다.
   */
  private async completions(userId: string, today: string): Promise<CompletionRow[]> {
    const { data, error } = await this.supabase.client
      .from('mission_completions')
      .select('mission_code, period_key, created_at')
      .eq('user_id', userId)
      .in('period_key', [today, ONCE]);

    if (error) {
      this.logger.error(`미션 기록 조회 실패 [${error.code}] ${error.message}`);
      throw ApiException.internal();
    }
    return (data ?? []) as CompletionRow[];
  }

  private async hasSoulmate(userId: string): Promise<boolean> {
    const { count, error } = await this.supabase.client
      .from('soulmates')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (error) {
      this.logger.error(`soulmates 조회 실패 [${error.code}] ${error.message}`);
      throw ApiException.internal();
    }
    return (count ?? 0) > 0;
  }
}

function notYet(code: MissionCode): MissionState {
  return {
    code,
    reward: MISSION_REWARDS[code],
    claimable: false,
    claimedAt: null,
    blockedReason: '준비 중이에요.',
    streak: null,
  };
}

/** KST 기준 오늘. period_key 는 마이그레이션과 같은 'YYYY-MM-DD' 여야 한다. */
function kstToday(): string {
  // en-CA 로케일이 YYYY-MM-DD 를 준다. 직접 조립하면 자릿수 패딩을 빠뜨리기 쉽다.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
}
