import { Injectable, Logger } from '@nestjs/common';
import {
  MEMORY_PIN_LIMIT,
  type CreateMemorySchema,
  type MemoryDto,
  type MemoryKind,
  type MemoryListResponse,
  type UpdateMemoryRequest,
} from '@mysoulmate/shared';
import type { z } from 'zod';
import { SupabaseService } from '../supabase/supabase.module';
import { ApiException } from '../common/api-exception';

interface MemoryRow {
  id: string;
  kind: MemoryKind;
  content: string;
  importance: number;
  pinned: boolean;
  created_at: string;
}

/**
 * 기억 관리.
 *
 * 모델이 넣은 기억은 낡는다 — "금요일에 발표가 있다" 는 발표가 끝나도 남아서
 * 다음 주에도 물어본다. 사용자가 직접 지우고 고칠 수 있어야 한다.
 *
 * 모든 조회/수정은 `soulmate_id` 로 한 번 더 거른다. 남의 기억 id 를 넣어도
 * 조건에 걸려 아무 행도 맞지 않는다(존재 여부조차 알려주지 않는다).
 */
@Injectable()
export class MemoriesService {
  private readonly logger = new Logger(MemoriesService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async list(userId: string): Promise<MemoryListResponse> {
    const soulmateId = await this.soulmateId(userId);

    // 화면 순서는 회상 순서와 같게 둔다. 위에 있는 것이 실제로 먼저 들어간다.
    const { data, error } = await this.supabase.client
      .from('memories')
      .select('id, kind, content, importance, pinned, created_at')
      .eq('soulmate_id', soulmateId)
      .order('pinned', { ascending: false })
      .order('importance', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error(`기억 조회 실패 [${error.code}] ${error.message}`);
      throw ApiException.internal();
    }

    const rows = (data ?? []) as MemoryRow[];
    return {
      memories: rows.map(toDto),
      pinnedCount: rows.filter((r) => r.pinned).length,
      pinLimit: MEMORY_PIN_LIMIT,
    };
  }

  /** 사용자가 직접 적는 기억. 대화가 압축될 때까지 기다리지 않아도 된다. */
  async create(userId: string, input: z.output<typeof CreateMemorySchema>): Promise<MemoryDto> {
    const soulmateId = await this.soulmateId(userId);
    if (input.pinned) await this.assertPinAvailable(soulmateId);

    const { data, error } = await this.supabase.client
      .from('memories')
      .insert({
        soulmate_id: soulmateId,
        kind: input.kind,
        content: input.content,
        importance: input.importance,
        pinned: input.pinned,
      })
      .select('id, kind, content, importance, pinned, created_at')
      .single<MemoryRow>();

    if (error || !data) {
      this.logger.error(`기억 저장 실패 [${error?.code}] ${error?.message}`);
      throw ApiException.internal();
    }
    return toDto(data);
  }

  async update(userId: string, id: string, patch: UpdateMemoryRequest): Promise<MemoryDto> {
    const soulmateId = await this.soulmateId(userId);

    // 고정 상한은 켜는 순간에만 본다. 이미 켜져 있는 걸 다시 켜도 통과해야 한다.
    if (patch.pinned === true && !(await this.isPinned(soulmateId, id))) {
      await this.assertPinAvailable(soulmateId);
    }

    const changes: Record<string, unknown> = {};
    if (patch.content !== undefined) changes.content = patch.content;
    if (patch.importance !== undefined) changes.importance = patch.importance;
    if (patch.pinned !== undefined) changes.pinned = patch.pinned;

    const { data, error } = await this.supabase.client
      .from('memories')
      .update(changes)
      .eq('id', id)
      .eq('soulmate_id', soulmateId)
      .select('id, kind, content, importance, pinned, created_at')
      .maybeSingle<MemoryRow>();

    if (error) {
      this.logger.error(`기억 수정 실패 [${error.code}] ${error.message}`);
      throw ApiException.internal();
    }
    if (!data) throw ApiException.notFound('그 기억은 없어요.');
    return toDto(data);
  }

  async remove(userId: string, id: string): Promise<void> {
    const soulmateId = await this.soulmateId(userId);

    const { error } = await this.supabase.client
      .from('memories')
      .delete()
      .eq('id', id)
      .eq('soulmate_id', soulmateId);

    if (error) {
      this.logger.error(`기억 삭제 실패 [${error.code}] ${error.message}`);
      throw ApiException.internal();
    }
  }

  private async soulmateId(userId: string): Promise<string> {
    const { data, error } = await this.supabase.client
      .from('soulmates')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle<{ id: string }>();

    if (error) {
      this.logger.error(`소울메이트 조회 실패 [${error.code}] ${error.message}`);
      throw ApiException.internal();
    }
    if (!data) throw ApiException.notFound('아직 소울메이트가 없어요.');
    return data.id;
  }

  private async isPinned(soulmateId: string, id: string): Promise<boolean> {
    const { data } = await this.supabase.client
      .from('memories')
      .select('pinned')
      .eq('id', id)
      .eq('soulmate_id', soulmateId)
      .maybeSingle<{ pinned: boolean }>();

    return data?.pinned === true;
  }

  private async assertPinAvailable(soulmateId: string): Promise<void> {
    const { count, error } = await this.supabase.client
      .from('memories')
      .select('id', { count: 'exact', head: true })
      .eq('soulmate_id', soulmateId)
      .eq('pinned', true);

    if (error) {
      this.logger.error(`고정 개수 조회 실패 [${error.code}] ${error.message}`);
      throw ApiException.internal();
    }
    if ((count ?? 0) >= MEMORY_PIN_LIMIT) {
      throw ApiException.validationFailed(
        `고정은 ${MEMORY_PIN_LIMIT}개까지예요. 덜 중요한 것을 먼저 풀어주세요.`,
      );
    }
  }
}

function toDto(row: MemoryRow): MemoryDto {
  return {
    id: row.id,
    kind: row.kind,
    content: row.content,
    importance: row.importance,
    pinned: row.pinned,
    createdAt: row.created_at,
  };
}
