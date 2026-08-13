// PWA 아이콘을 icon.svg 하나에서 뽑는다.
//
//   pnpm --filter @mysoulmate/web icons:pwa
//
// 손으로 만든 PNG를 여러 장 두면 로고를 고칠 때 한두 장을 빼먹는다.
// 출처를 SVG 하나로 두고 나머지는 여기서 파생시킨다.
//
// maskable 이 따로 필요한 이유: 안드로이드는 아이콘을 원형이나 스퀴클로 잘라낸다.
// 우리 SVG 는 모서리까지 그림이 차 있어서 그대로 넣으면 하트 끝이 잘린다.
// 안전 영역(가운데 80%)에 맞춰 그림을 줄이고 남는 자리는 배경색으로 채운다.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const svgPath = path.join(here, '..', 'src', 'app', 'icon.svg');
const outDir = path.join(here, '..', 'public', 'icons');

/** icon.svg 의 그라디언트 시작색. 잘려나간 자리를 메울 때 쓴다. */
const BRAND = '#e29c9c';

/** 안드로이드 maskable 안전 영역. 규격은 가운데 80% 원 안이다. */
const SAFE_RATIO = 0.8;

await mkdir(outDir, { recursive: true });

const targets = [
  { size: 192, name: 'icon-192.png', maskable: false },
  { size: 512, name: 'icon-512.png', maskable: false },
  { size: 512, name: 'maskable-512.png', maskable: true },
];

for (const target of targets) {
  const inner = target.maskable ? Math.round(target.size * SAFE_RATIO) : target.size;
  const pad = Math.round((target.size - inner) / 2);

  const rendered = await sharp(svgPath, { density: 384 })
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  const image = target.maskable
    ? await sharp({
        create: {
          width: target.size,
          height: target.size,
          channels: 4,
          background: BRAND,
        },
      })
        .composite([{ input: rendered, top: pad, left: pad }])
        .png()
        .toBuffer()
    : rendered;

  await writeFile(path.join(outDir, target.name), image);
  console.log(`  ${target.name}  ${target.size}x${target.size}  ${(image.length / 1024).toFixed(0)}KB`);
}

console.log('');
console.log(`아이콘 ${targets.length}개를 public/icons 에 만들었습니다.`);
