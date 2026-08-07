import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // 워크스페이스 패키지는 dist(CommonJS)로 빌드해 두므로 Next가 그대로 번들한다.
  // 소스를 직접 물리게 하려면 transpilePackages에 넣어야 하는데,
  // 지금 구조에서는 빌드 순서(shared -> web)가 스크립트에 박혀 있어 필요 없다.
  reactStrictMode: true,
};

export default nextConfig;
