import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  AppearanceSchema,
  CREDIT_COSTS,
  PersonaSchema,
  getPreset,
  vibeForArchetype,
  type Appearance,
  type OnboardingAnswers,
  type Persona,
  type SoulmateResponse,
} from '@mysoulmate/shared';
import { SupabaseService } from '../supabase/supabase.module';
import { CreditsService } from '../credits/credits.service';
import { ApiException } from '../common/api-exception';
import { ModelBlockedError, ModelRateLimitedError } from '../ai/errors';
import type { AuthUser } from '../auth/current-user.decorator';
import { PersonaService } from './persona.service';
import { AvatarService } from './avatar.service';

interface SoulmateRow {
  id: string;
  name: string;
  tone: 'friend' | 'mentor' | 'partner';
  persona: unknown;
  appearance: unknown;
  current_avatar_id: string | null;
  created_at: string;
}

@Injectable()
export class SoulmateService {
  private readonly logger = new Logger(SoulmateService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly credits: CreditsService,
    private readonly personas: PersonaService,
    private readonly avatars: AvatarService,
  ) {}

  /**
   * 온보딩 완료 — 페르소나와 아바타를 만들고 저장한다. 첫 생성은 무료다.
   *
   * DB 쓰기는 전부 마지막에 몰아서 한 트랜잭션(create_soulmate)으로 처리한다.
   * 실패 확률이 높은 건 AI 호출 쪽이라, 그게 끝난 뒤에 쓰면 중간에 깨진 행이 남지 않는다.
   */
  async create(user: AuthUser, answers: OnboardingAnswers): Promise<SoulmateResponse> {
    const userId = user.id;
    if (await this.findRow(userId)) {
      throw ApiException.alreadyClaimed('이미 소울메이트가 있어요.');
    }

    // Storage 경로에 id가 필요해서 행보다 먼저 만든다.
    const soulmateId = randomUUID();

    const appearance: Appearance = AppearanceSchema.parse({
      archetype: answers.archetype,
      // 성별 표현은 고른 프리셋 캐릭터에서 가져온다. 따로 묻지 않는다.
      presentation: getPreset(answers.presetId).presentation,
      vibe: vibeForArchetype(answers.archetype),
      presetId: answers.presetId,
    });

    // 페르소나는 실패하면 만들 게 없으므로 그대로 실패시킨다.
    const persona = await this.runModel(() => this.personas.generate(answers));

    // 온보딩에서는 이미지를 생성하지 않는다. 프리셋 캐릭터를 골랐으므로
    // 모습은 이미 정해져 있다. 이렇게 두면 온보딩에 실패 지점도 비용도 없다.
    // "AI로 만든 나만의 모습" 은 홈 카드에서 따로 만든다.
    const { error } = await this.supabase.client.rpc('create_soulmate', {
      p_user: userId,
      p_soulmate_id: soulmateId,
      p_name: persona.name,
      p_tone: answers.tone,
      p_persona: persona,
      p_appearance: appearance,
      p_storage_path: null,
      p_image_prompt: null,
      p_greeting: persona.greeting,
    });

    if (error) {
      this.logger.error(`create_soulmate 실패 [${error.code}] ${error.message}`);
      throw ApiException.internal();
    }

    const created = await this.get(userId);
    if (!created) throw ApiException.internal();
    return created;
  }

  /**
   * 아바타 생성/재생성.
   *
   * 첫 아바타를 아직 못 받은 소울메이트라면 무료다 —
   * 온보딩 중 이미지가 실패해서 비어 있는 경우가 여기 해당한다.
   * 이미 아바타가 있으면 크레딧을 먼저 차감하고 실패하면 되돌린다.
   * (반대 순서면 응답만 받고 끊어서 공짜로 쓸 수 있다)
   */
  async regenerateAvatar(user: AuthUser, changeRequest?: string): Promise<SoulmateResponse> {
    const userId = user.id;
    const row = await this.findRow(userId);
    if (!row) throw ApiException.notFound('소울메이트가 아직 없어요.');

    const persona = PersonaSchema.parse(row.persona);
    const appearance = AppearanceSchema.parse(row.appearance);

    const isFirstAvatar = row.current_avatar_id === null;

    const spend = isFirstAvatar
      ? { freeUsed: 0, paidUsed: 0 }
      : await this.credits.spend({
          userId,
          amount: CREDIT_COSTS.avatarRegenerate,
          reason: 'avatar_regenerate_spend',
          // 아바타에는 무료 쿼터가 없다. 대화용 무료 턴을 여기서 태우면 안 된다.
          freeAllowance: 0,
          refType: 'soulmate',
          refId: row.id,
          unlimited: user.isAdmin,
        });

    try {
      // 같은 인물을 유지하려면 이전 이미지를 입력으로 넣어야 한다.
      const baseImage = row.current_avatar_id
        ? await this.loadCurrentImage(row.current_avatar_id)
        : null;

      const avatar = await this.runModel(() =>
        this.avatars.createAndStore({
          userId,
          soulmateId: row.id,
          persona,
          appearance,
          ...(baseImage ? { baseImage } : {}),
          ...(changeRequest ? { changeRequest } : {}),
        }),
      );

      const { error } = await this.supabase.client.rpc('replace_soulmate_avatar', {
        p_user: userId,
        p_soulmate_id: row.id,
        p_storage_path: avatar.storagePath,
        p_image_prompt: avatar.prompt,
        p_source_avatar_id: row.current_avatar_id,
      });
      if (error) {
        this.logger.error(`replace_soulmate_avatar 실패 [${error.code}] ${error.message}`);
        throw ApiException.internal();
      }
    } catch (err) {
      await this.credits.refund({
        userId,
        freeUsed: spend.freeUsed,
        paidUsed: spend.paidUsed,
        refType: 'soulmate',
        refId: row.id,
      });
      throw err;
    }

    const updated = await this.get(userId);
    if (!updated) throw ApiException.internal();
    return updated;
  }

  /**
   * 소울메이트를 지운다. 대화 기록까지 함께 사라지는 되돌릴 수 없는 작업이다.
   *
   * 지운 뒤에는 온보딩을 처음부터 다시 할 수 있다.
   * 일반 사용자에게 재생성보다 비싼 값을 매기는 이유는,
   * 지우고 다시 만들면 첫 아바타를 또 무료로 받기 때문이다.
   */
  async reset(user: AuthUser): Promise<void> {
    const userId = user.id;
    const row = await this.findRow(userId);
    if (!row) throw ApiException.notFound('소울메이트가 아직 없어요.');

    const spend = await this.credits.spend({
      userId,
      amount: CREDIT_COSTS.soulmateReset,
      reason: 'soulmate_reset_spend',
      freeAllowance: 0,
      refType: 'soulmate',
      refId: row.id,
      unlimited: user.isAdmin,
    });

    // DB를 지우면 Storage 경로를 알 방법이 없어지므로 먼저 모아둔다.
    const paths = await this.avatarPaths(row.id);

    const { error } = await this.supabase.client.rpc('delete_soulmate', {
      p_user: userId,
      p_soulmate_id: row.id,
    });

    if (error) {
      await this.credits.refund({
        userId,
        freeUsed: spend.freeUsed,
        paidUsed: spend.paidUsed,
        refType: 'soulmate',
        refId: row.id,
      });
      this.logger.error(`delete_soulmate 실패 [${error.code}] ${error.message}`);
      throw ApiException.internal();
    }

    // 이미지 파일은 FK cascade가 지워주지 않는다. 남겨두면 무료 1GB를 갉아먹는다.
    // 여기서 실패해도 사용자 입장에서는 삭제가 끝난 것이므로 로그만 남긴다.
    if (paths.length > 0) {
      const { error: removeError } = await this.supabase.client.storage
        .from('avatars')
        .remove(paths);
      if (removeError) {
        this.logger.error(`아바타 파일 정리 실패 (${paths.length}건): ${removeError.message}`);
      }
    }
  }

  async get(userId: string): Promise<SoulmateResponse | null> {
    const row = await this.findRow(userId);
    if (!row) return null;

    let avatarUrl: string | null = null;
    let avatarExpiresAt: string | null = null;

    if (row.current_avatar_id) {
      const path = await this.avatarPath(row.current_avatar_id);
      const signed = path ? await this.avatars.signedUrl(path) : null;
      if (signed) {
        avatarUrl = signed.url;
        avatarExpiresAt = signed.expiresAt;
      }
    }

    const appearance = AppearanceSchema.parse(row.appearance);

    return {
      id: row.id,
      name: row.name,
      tone: row.tone,
      persona: PersonaSchema.parse(row.persona),
      appearance,
      avatarUrl,
      avatarExpiresAt,
      hasAvatar: row.current_avatar_id !== null,
      presetId: appearance.presetId ?? null,
      createdAt: row.created_at,
    };
  }

  private async findRow(userId: string): Promise<SoulmateRow | null> {
    const { data, error } = await this.supabase.client
      .from('soulmates')
      .select('id, name, tone, persona, appearance, current_avatar_id, created_at')
      .eq('user_id', userId)
      .maybeSingle<SoulmateRow>();

    if (error) {
      this.logger.error(`soulmates 조회 실패 [${error.code}] ${error.message}`);
      throw ApiException.internal();
    }
    return data;
  }

  private async avatarPath(avatarId: string): Promise<string | null> {
    const { data, error } = await this.supabase.client
      .from('soulmate_avatars')
      .select('storage_path')
      .eq('id', avatarId)
      .maybeSingle<{ storage_path: string }>();

    if (error) {
      this.logger.error(`아바타 경로 조회 실패 [${error.code}] ${error.message}`);
      return null;
    }
    return data?.storage_path ?? null;
  }

  /** 소울메이트에 딸린 모든 아바타 파일 경로. 삭제 시 Storage 정리에 쓴다. */
  private async avatarPaths(soulmateId: string): Promise<string[]> {
    const { data, error } = await this.supabase.client
      .from('soulmate_avatars')
      .select('storage_path')
      .eq('soulmate_id', soulmateId);

    if (error) {
      this.logger.error(`아바타 경로 목록 조회 실패 [${error.code}] ${error.message}`);
      return [];
    }
    return (data ?? []).map((r: { storage_path: string }) => r.storage_path);
  }

  private async loadCurrentImage(avatarId: string) {
    const path = await this.avatarPath(avatarId);
    return path ? this.avatars.download(path) : null;
  }

  /** 모델 오류를 프론트가 분기할 수 있는 API 오류로 옮긴다. */
  private async runModel<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof ModelRateLimitedError) {
        throw ApiException.modelRateLimited(err.retryAfterSeconds);
      }
      if (err instanceof ModelBlockedError) {
        throw ApiException.contentBlocked(
          '요청하신 내용으로는 만들기 어려웠어요. 표현을 조금 바꿔서 다시 시도해 주세요.',
        );
      }
      this.logger.error(`모델 호출 실패: ${err instanceof Error ? err.message : String(err)}`);
      throw ApiException.modelUnavailable();
    }
  }
}
