'use client';

import { useState } from 'react';
import {
  PRESET_CHARACTERS,
  RELATIONSHIP_TONES,
  RELATIONSHIP_TONE_META,
  SPEECH_STYLES,
  SPEECH_STYLE_META,
  presetImagePath,
  type PresetId,
  type RelationshipTone,
  type SoulmateResponse,
  type SpeechStyle,
  type UpdateSoulmateRequest,
} from '@mysoulmate/shared';
import { ApiError, apiFetch } from '@/lib/api';

/**
 * 설정 고치기.
 *
 * 여기 있는 것만 대화 기록과 기억을 지키면서 바꿀 수 있다. 전부 비용이 0이라 무료다.
 * 성격이나 배경은 없다 — 그건 캐릭터의 정체성이라 바꾸려면 처음부터 다시 만드는 게 맞다.
 */
export function SoulmateSettings({
  soulmate,
  onUpdated,
  onClose,
}: {
  soulmate: SoulmateResponse;
  onUpdated: (next: SoulmateResponse) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(soulmate.name);
  const [tone, setTone] = useState<RelationshipTone>(soulmate.tone);
  const [speechStyle, setSpeechStyle] = useState<SpeechStyle>(soulmate.persona.speechStyle);
  const [presetId, setPresetId] = useState<PresetId | null>(
    (soulmate.presetId as PresetId | null) ?? null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // AI로 만든 모습을 쓰고 있으면 프리셋을 골라도 화면에 보이지 않는다.
  // 고를 수 있는 것처럼 두고 아무 일도 안 일어나는 게 제일 나쁘다.
  const presetEditable = !soulmate.hasAvatar;

  const patch: UpdateSoulmateRequest = {
    ...(name.trim() && name.trim() !== soulmate.name ? { name: name.trim() } : {}),
    ...(tone !== soulmate.tone ? { tone } : {}),
    ...(speechStyle !== soulmate.persona.speechStyle ? { speechStyle } : {}),
    ...(presetEditable && presetId && presetId !== soulmate.presetId ? { presetId } : {}),
  };
  const changed = Object.keys(patch).length > 0;

  // 말투를 바꿀 때만 모델을 부른다(예시 문장을 새 말투로 옮겨야 해서).
  const restyling = patch.speechStyle !== undefined;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      onUpdated(
        await apiFetch<SoulmateResponse>('/soulmate', {
          method: 'PATCH',
          body: JSON.stringify(patch),
        }),
      );
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '바꾸지 못했어요.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-5 rounded-xl border border-blush/40 p-4">
      <p className="text-sm font-medium">고치기</p>
      <p className="mt-1 text-xs leading-relaxed text-ink-soft dark:text-cream/50">
        지금까지 나눈 대화와 기억은 그대로 남아요. 크레딧도 들지 않아요.
      </p>

      <label className="mt-4 block text-xs text-ink-soft dark:text-cream/60">부르는 이름</label>
      <input
        value={name}
        onChange={(e) => setName(e.target.value.slice(0, 20))}
        className="mt-1.5 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-[15px] outline-none focus:border-blush dark:border-white/15 dark:bg-night"
      />

      <p className="mt-4 text-xs text-ink-soft dark:text-cream/60">관계</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {RELATIONSHIP_TONES.map((t) => (
          <Chip key={t} selected={tone === t} onClick={() => setTone(t)}>
            {RELATIONSHIP_TONE_META[t].label}
          </Chip>
        ))}
      </div>

      <p className="mt-4 text-xs text-ink-soft dark:text-cream/60">말투</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {SPEECH_STYLES.map((s) => (
          <Chip key={s} selected={speechStyle === s} onClick={() => setSpeechStyle(s)}>
            {SPEECH_STYLE_META[s].label}
          </Chip>
        ))}
      </div>

      <p className="mt-4 text-xs text-ink-soft dark:text-cream/60">모습</p>
      {presetEditable ? (
        <div className="mt-1.5 grid grid-cols-4 gap-1.5">
          {PRESET_CHARACTERS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPresetId(p.id)}
              className={`overflow-hidden rounded-lg border-2 ${
                presetId === p.id ? 'border-blush' : 'border-transparent opacity-60'
              }`}
            >
              {/* 정적 프리셋이라 Next 이미지 최적화를 태우지 않는다. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={presetImagePath(p.id, 'neutral')}
                alt={p.label}
                className="aspect-square w-full object-cover"
              />
            </button>
          ))}
        </div>
      ) : (
        <p className="mt-1.5 text-xs leading-relaxed text-ink-soft dark:text-cream/50">
          AI로 만든 모습을 쓰고 있어요. 바꾸려면 아래 &ldquo;모습 다시 그리기&rdquo;를 써주세요.
        </p>
      )}

      {restyling && (
        <p className="mt-4 text-xs leading-relaxed text-ink-soft dark:text-cream/50">
          말투를 바꾸면 말버릇도 같이 옮겨요. 몇 초 걸릴 수 있어요.
        </p>
      )}
      {error && <p className="mt-2 text-sm text-blush-deep">{error}</p>}

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="rounded-full border border-black/10 px-4 py-2 text-sm dark:border-white/15"
        >
          취소
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy || !changed}
          className="flex-1 rounded-full bg-blush px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {busy ? (restyling ? '말투 옮기는 중…' : '저장 중…') : changed ? '저장' : '바뀐 게 없어요'}
        </button>
      </div>
    </div>
  );
}

function Chip({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3.5 py-1.5 text-sm ${
        selected
          ? 'bg-blush text-white'
          : 'bg-white text-ink-soft dark:bg-white/10 dark:text-cream/60'
      }`}
    >
      {children}
    </button>
  );
}
