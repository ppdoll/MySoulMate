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
  self_intro: string | null;
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
      selfIntro: profile.self_intro,
    };

    return { profile: summary, wallet, hasSoulmate, isAdmin: user.isAdmin };
  }

  /** 사용자 소개 저장. 빈 문자열이면 지운 것으로 본다. */
  async updateSelfIntro(userId: string, selfIntro: string): Promise<void> {
    const value = selfIntro.trim();
    const { error } = await this.supabase.client
      .from('profiles')
      .update({ self_intro: value || null })
      .eq('id', userId);

    if (error) {
      this.logger.error(`소개 저장 실패 [${error.code}] ${error.message}`);
      throw ApiException.internal();
    }
  }

  /**
   * 회원 탈퇴 — 계정과 그에 딸린 모든 것을 지운다.
   *
   * 개인정보 처리방침이 "회원 탈퇴 시까지 보관" 이라고 약속하고 있으므로 이 경로가
   * 실제로 있어야 그 문장이 사실이 된다(개인정보보호법 제21조 파기, 제35조~제37조 권리).
   *
   * auth.users 한 행을 지우면 profiles 로 cascade 되고, 그 아래 소울메이트·대화·요약·
   * 기억·되돌린 응답 기록·크레딧·초대 기록이 FK 를 따라 전부 함께 사라진다.
   * 지울 목록을 코드로 나열하지 않는 이유가 그것이다 — 새 테이블을 추가할 때
   * 여기를 고치는 걸 잊어도 남지 않는다.
   */
  async deleteAccount(userId: string): Promise<void> {
    // DB 를 지우면 Storage 경로를 알 방법이 없어지므로 먼저 모아둔다.
    const paths = await this.avatarPaths(userId);

    const { error } = await this.supabase.client.auth.admin.deleteUser(userId);
    if (error) {
      this.logger.error(`계정 삭제 실패 user=${userId}: ${error.message}`);
      throw ApiException.internal();
    }

    // 이미지 파일은 FK cascade 가 지워주지 않는다. 남겨두면 무료 1GB 를 갉아먹고,
    // 무엇보다 "전부 삭제" 라고 말한 것과 어긋난다.
    if (paths.length > 0) {
      const { error: removeError } = await this.supabase.client.storage
        .from('avatars')
        .remove(paths);
      if (removeError) {
        // 계정은 이미 사라졌다. 사용자 입장에서는 탈퇴가 끝난 것이라 여기서 실패시키지 않는다.
        this.logger.error(
          `탈퇴 후 이미지 정리 실패 (${paths.length}건) user=${userId}: ${removeError.message}`,
        );
      }
    }

    this.logger.log(`계정 삭제 완료 user=${userId} (이미지 ${paths.length}건)`);
  }

  /** 이 사용자의 모든 아바타 파일 경로. 탈퇴 시 Storage 정리에 쓴다. */
  private async avatarPaths(userId: string): Promise<string[]> {
    const { data, error } = await this.supabase.client
      .from('soulmate_avatars')
      .select('storage_path, soulmates!inner(user_id)')
      .eq('soulmates.user_id', userId);

    if (error) {
      // 경로를 못 읽어도 탈퇴 자체는 진행한다. 파일이 남는 것보다 계정이 남는 게 나쁘다.
      this.logger.error(`아바타 경로 조회 실패 [${error.code}] ${error.message}`);
      return [];
    }
    return (data ?? []).map((r: { storage_path: string }) => r.storage_path);
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
      .select('id, display_name, avatar_url, referral_code, self_intro')
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
