import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  AppearanceSchema,
  CREDIT_COSTS,
  PersonaSchema,
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
  async create(userId: string, answers: OnboardingAnswers): Promise<SoulmateResponse> {
    if (await this.findRow(userId)) {
      throw ApiException.alreadyClaimed('이미 소울메이트가 있어요.');
    }

    // Storage 경로에 id가 필요해서 행보다 먼저 만든다.
    const soulmateId = randomUUID();

    const appearance: Appearance = AppearanceSchema.parse({
      archetype: answers.archetype,
      presentation: answers.presentation,
      vibe: vibeForArchetype(answers.archetype),
      ...(answers.appearanceNote ? { note: answers.appearanceNote } : {}),
    });

    // 페르소나는 실패하면 만들 게 없으므로 그대로 실패시킨다.
    const persona = await this.runModel(() => this.personas.generate(answers));

    // 아바타는 실패해도 온보딩을 끝낸다.
    // 이미지는 텍스트보다 실패 확률이 높은데(결제 미설정, 분당 한도, 안전 필터),
    // 그것 때문에 사용자가 답한 질문 10개를 버리게 하면 안 된다.
    // 아바타 없이 만들어두고 나중에 채운다 — 첫 아바타는 그때도 무료다.
    const avatar = await this.tryCreateAvatar({ userId, soulmateId, persona, appearance });

    const { error } = await this.supabase.client.rpc('create_soulmate', {
      p_user: userId,
      p_soulmate_id: soulmateId,
      p_name: persona.name,
      p_tone: answers.tone,
      p_persona: persona,
      p_appearance: appearance,
      p_storage_path: avatar?.storagePath ?? null,
      p_image_prompt: avatar?.prompt ?? null,
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

  /** 온보딩 중 아바타 생성. 실패해도 예외를 던지지 않고 null을 돌려준다. */
  private async tryCreateAvatar(params: {
    userId: string;
    soulmateId: string;
    persona: Persona;
    appearance: Appearance;
  }) {
    try {
      return await this.avatars.createAndStore(params);
    } catch (err) {
      this.logger.warn(
        `아바타 생성 실패 — 소울메이트는 이미지 없이 생성합니다. user=${params.userId}: ` +
          (err instanceof Error ? err.message : String(err)),
      );
      return null;
    }
  }

  /**
   * 아바타 생성/재생성.
   *
   * 첫 아바타를 아직 못 받은 소울메이트라면 무료다 —
   * 온보딩 중 이미지가 실패해서 비어 있는 경우가 여기 해당한다.
   * 이미 아바타가 있으면 크레딧을 먼저 차감하고 실패하면 되돌린다.
   * (반대 순서면 응답만 받고 끊어서 공짜로 쓸 수 있다)
   */
  async regenerateAvatar(userId: string, changeRequest?: string): Promise<SoulmateResponse> {
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

    return {
      id: row.id,
      name: row.name,
      tone: row.tone,
      persona: PersonaSchema.parse(row.persona),
      appearance: AppearanceSchema.parse(row.appearance),
      avatarUrl,
      avatarExpiresAt,
      hasAvatar: row.current_avatar_id !== null,
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
