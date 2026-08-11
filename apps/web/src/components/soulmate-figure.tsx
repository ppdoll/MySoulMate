'use client';

import { useEffect, useState } from 'react';
import {
  presetImagePath,
  type Expression,
  type PresetId,
  type SoulmateResponse,
} from '@mysoulmate/shared';

/**
 * 소울메이트의 모습.
 *
 * 프리셋 캐릭터는 표정별 이미지가 있어 감정에 따라 교체된다.
 * AI로 만든 아바타는 한 장뿐이라 표정은 바뀌지 않고 모션만 적용된다.
 *
 * 정지 이미지라도 아주 느린 호흡 움직임과 새 메시지에 반응하는 튐이 있으면
 * 꽤 살아 있는 것처럼 보인다. 이건 CSS만으로 되고 비용이 0이다.
 */
export function SoulmateFigure({
  soulmate,
  expression,
  speaking,
}: {
  soulmate: SoulmateResponse;
  expression: Expression;
  /** 응답이 도착하는 중. 살짝 튀어오르게 해서 반응을 만든다. */
  speaking?: boolean;
}) {
  const [failed, setFailed] = useState(false);

  // 표정이 바뀔 때마다 로드 실패 상태를 초기화한다.
  // 한 표정 파일이 없다고 다른 표정까지 못 쓰게 되면 안 된다.
  useEffect(() => setFailed(false), [expression, soulmate.presetId]);

  // AI 아바타가 있으면 그걸 우선한다. 사용자가 돈을 들여 만든 것이다.
  const src = soulmate.avatarUrl
    ? soulmate.avatarUrl
    : soulmate.presetId
      ? presetImagePath(soulmate.presetId as PresetId, failed ? 'neutral' : expression)
      : null;

  return (
    <div
      className={`relative mx-auto aspect-square w-full max-w-[220px] overflow-hidden rounded-3xl bg-cream-deep transition-transform duration-300 dark:bg-night-soft ${
        speaking ? 'scale-[1.02]' : 'scale-100'
      }`}
      style={{ animation: 'soulmate-breathe 5s ease-in-out infinite' }}
    >
      {src ? (
        // 서명 URL과 정적 파일이 섞여 있어 Next 이미지 최적화를 태우지 않는다.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={src}
          src={src}
          alt={`${soulmate.name}의 모습`}
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-4xl">🤍</div>
      )}
    </div>
  );
}
