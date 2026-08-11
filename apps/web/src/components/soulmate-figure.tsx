'use client';

import { useEffect, useRef, useState } from 'react';
import {
  EXPRESSIONS,
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
 * 표정을 하드 교체하지 않고 겹쳐서 크로스페이드하는 이유:
 * 이미지 모델로 만든 표정 변형은 인물은 같아도 배경과 구도가 미세하게 흔들린다.
 * 즉시 바꾸면 그 차이가 '튐' 으로 보이는데, 짧은 페이드로 덮으면 자연스러워진다.
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
  const preset = soulmate.presetId as PresetId | null;

  // AI 아바타가 있으면 그걸 우선한다. 사용자가 직접 만든 것이다.
  const custom = soulmate.avatarUrl;

  const [shown, setShown] = useState<Expression>(expression);
  const [previous, setPrevious] = useState<Expression | null>(null);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (custom || expression === shown) return;

    // 이전 표정을 잠깐 아래에 남겨두고 새 표정을 위에서 띄운다.
    setPrevious(shown);
    setShown(expression);

    if (fadeTimer.current) clearTimeout(fadeTimer.current);
    fadeTimer.current = setTimeout(() => setPrevious(null), 320);
    return () => {
      if (fadeTimer.current) clearTimeout(fadeTimer.current);
    };
  }, [expression, shown, custom]);

  return (
    <div
      className={`relative mx-auto aspect-square w-full max-w-[220px] overflow-hidden rounded-3xl bg-cream-deep transition-transform duration-300 dark:bg-night-soft ${
        speaking ? 'scale-[1.02]' : 'scale-100'
      }`}
      style={{ animation: 'soulmate-breathe 5s ease-in-out infinite' }}
    >
      {custom ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={custom}
          alt={`${soulmate.name}의 모습`}
          className="h-full w-full object-cover"
        />
      ) : preset ? (
        <>
          {/* 표정 이미지를 전부 겹쳐두고 보이는 것만 불투명하게 한다.
              이렇게 하면 첫 전환에서 로딩 때문에 깜빡이지 않는다. */}
          {EXPRESSIONS.map((e) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={e}
              src={presetImagePath(preset, e)}
              alt={e === shown ? `${soulmate.name}의 모습` : ''}
              aria-hidden={e !== shown}
              className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
                e === shown ? 'opacity-100' : e === previous ? 'opacity-100' : 'opacity-0'
              }`}
              style={{ zIndex: e === shown ? 2 : e === previous ? 1 : 0 }}
            />
          ))}
        </>
      ) : (
        <div className="flex h-full w-full items-center justify-center text-4xl">🤍</div>
      )}
    </div>
  );
}
