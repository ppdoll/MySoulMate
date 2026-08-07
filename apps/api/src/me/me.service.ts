import { Injectable, Logger } from '@nestjs/common';
import type { MeResponse, ProfileSummary } from '@mysoulmate/shared';
import { SupabaseService } from '../supabase/supabase.module';
import { CreditsService } from '../credits/credits.service';
import { ApiException } from '../common/api-exception';
import type { AuthUser } from '../auth/current-user.decorator';

interface ProfileRow {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  referral_code: string;
}

@Injectable()
export class MeService {
  private readonly logger = new Logger(MeService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly credits: CreditsService,
  ) {}

  async getMe(user: AuthUser): Promise<MeResponse> {
    const profile = await this.loadOrProvisionProfile(user);

    const [wallet, hasSoulmate] = await Promise.all([
      this.credits.getWallet(user.id),
      this.hasSoulmate(user.id),
    ]);

    const summary: ProfileSummary = {
      id: profile.id,
      displayName: profile.display_name,
      avatarUrl: profile.avatar_url,
      referralCode: profile.referral_code,
    };

    return { profile: summary, wallet, hasSoulmate };
  }

  /**
   * 프로필은 auth.users INSERT 트리거가 만든다.
   * 그런데 마이그레이션보다 먼저 로그인해버린 계정은 프로필이 없는 상태로 남는다.
   * 개발 중에 반드시 한 번은 겪는 상황이라 여기서 조용히 보정한다.
   */
  private async loadOrProvisionProfile(user: AuthUser): Promise<ProfileRow> {
    const existing = await this.fetchProfile(user.id);
    if (existing) return existing;

    this.logger.warn(`프로필이 없어 보정합니다. user=${user.id}`);
    const { error } = await this.supabase.client.rpc('ensure_profile', {
      p_user: user.id,
      p_display_name: user.name,
      p_avatar_url: user.avatarUrl,
    });
    if (error) {
      this.logger.error(`ensure_profile 실패 [${error.code}] ${error.message}`);
      throw ApiException.internal();
    }

    const created = await this.fetchProfile(user.id);
    if (!created) throw ApiException.internal();
    return created;
  }

  private async fetchProfile(userId: string): Promise<ProfileRow | null> {
    const { data, error } = await this.supabase.client
      .from('profiles')
      .select('id, display_name, avatar_url, referral_code')
      .eq('id', userId)
      .maybeSingle<ProfileRow>();

    if (error) {
      this.logger.error(`profiles 조회 실패 [${error.code}] ${error.message}`);
      throw ApiException.internal();
    }
    return data;
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
