import { Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import type { Appearance, Persona } from '@mysoulmate/shared';
import { GeminiService, type ImageInput } from '../ai/gemini.service';
import { SupabaseService } from '../supabase/supabase.module';
import { ModelUnavailableError } from '../ai/errors';

const BUCKET = 'avatars';

/** 서명 URL 유효 시간. 화면에 띄우고 잠깐 쓰는 용도라 길 필요가 없다. */
const SIGNED_URL_TTL_SECONDS = 60 * 60;

/**
 * 무료 Storage가 1GB뿐이라 원본 PNG(장당 ~1.5MB)를 그대로 두면 금방 찬다.
 * 768px WebP로 줄이면 200KB 안쪽으로 떨어져 5,000장 이상 들어간다.
 */
const OUTPUT_SIZE = 768;
const WEBP_QUALITY = 82;

export interface StoredAvatar {
  storagePath: string;
  prompt: string;
}

@Injectable()
export class AvatarService {
  private readonly logger = new Logger(AvatarService.name);

  constructor(
    private readonly gemini: GeminiService,
    private readonly supabase: SupabaseService,
  ) {}

  /**
   * 아바타를 만들어 Storage에 넣는다.
   *
   * baseImage를 넘기면 그 이미지를 편집해 같은 인물을 유지한다.
   * 재생성에서 이걸 빠뜨리면 매번 다른 사람이 나와서 "내 소울메이트"라는 전제가 깨진다.
   */
  async createAndStore(params: {
    userId: string;
    soulmateId: string;
    persona: Persona;
    appearance: Appearance;
    baseImage?: ImageInput;
    /** 재생성 시 사용자가 추가로 요청한 변화. */
    changeRequest?: string;
  }): Promise<StoredAvatar> {
    const prompt = buildImagePrompt(params);

    const generated = await this.gemini.generateImage({
      prompt,
      ...(params.baseImage ? { baseImage: params.baseImage } : {}),
    });

    const webp = await sharp(generated.data)
      .resize(OUTPUT_SIZE, OUTPUT_SIZE, { fit: 'cover', position: 'attention' })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();

    const storagePath = `${params.userId}/${params.soulmateId}/${randomUUID()}.webp`;
    const { error } = await this.supabase.client.storage
      .from(BUCKET)
      .upload(storagePath, webp, { contentType: 'image/webp', upsert: false });

    if (error) {
      this.logger.error(`아바타 업로드 실패 ${storagePath}: ${error.message}`);
      throw new ModelUnavailableError('이미지를 저장하지 못했어요.');
    }

    return { storagePath, prompt };
  }

  /** 버킷이 비공개라 매번 서명 URL을 발급한다. 만료되므로 클라이언트가 캐시하면 안 된다. */
  async signedUrl(storagePath: string): Promise<{ url: string; expiresAt: string } | null> {
    const { data, error } = await this.supabase.client.storage
      .from(BUCKET)
      .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);

    if (error || !data) {
      this.logger.error(`서명 URL 발급 실패 ${storagePath}: ${error?.message}`);
      return null;
    }
    return {
      url: data.signedUrl,
      expiresAt: new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000).toISOString(),
    };
  }

  /** 재생성 때 이전 이미지를 모델 입력으로 다시 넣기 위해 내려받는다. */
  async download(storagePath: string): Promise<ImageInput | null> {
    const { data, error } = await this.supabase.client.storage.from(BUCKET).download(storagePath);
    if (error || !data) {
      this.logger.warn(`원본 아바타를 못 읽었습니다 ${storagePath}: ${error?.message}`);
      return null;
    }
    return {
      data: Buffer.from(await data.arrayBuffer()),
      mimeType: 'image/webp',
    };
  }
}

function buildImagePrompt(params: {
  persona: Persona;
  appearance: Appearance;
  baseImage?: ImageInput;
  changeRequest?: string;
}): string {
  if (params.baseImage) {
    // 편집 모드. 인물 동일성을 명시적으로 못박지 않으면 모델이 얼굴을 바꿔버린다.
    const change = params.changeRequest?.trim() || 'a different pose and outfit, same setting';
    return [
      'Keep the exact same person from the provided image:',
      'same face, same facial features, same hair color and style, same apparent age.',
      `Change only: ${change}.`,
      'Upper-body portrait, photorealistic, natural lighting, tasteful and fully clothed.',
    ].join(' ');
  }

  const note = params.appearance.note?.trim();
  return [
    params.persona.appearancePrompt,
    note ? `Additional request from the user: ${note}.` : '',
    'Upper-body portrait of an adult, photorealistic, sharp focus on the face,',
    'looking toward the viewer, tasteful and fully clothed, no text or watermark.',
  ]
    .filter(Boolean)
    .join(' ');
}
