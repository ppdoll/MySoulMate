/**
 * 법률 문서에 들어가는 사실 정보.
 *
 * 처리방침과 약관 두 곳에서 같은 값을 쓰므로 여기 한 곳에만 둔다.
 * 문서 본문에 직접 박아두면 이름이나 연락처를 바꿀 때 한쪽만 고치게 된다.
 *
 * ┌──────────────────────────────────────────────────────────────┐
 * │ 배포 전에 반드시 채워야 하는 값이 아래 NEEDS_FILL 에 모여 있다.  │
 * │ 개인정보 보호책임자의 성명과 연락처는 법정 공개 항목이라       │
 * │ (개인정보보호법 제30조 제1항 제6호) 비워두면 방침이 성립하지    │
 * │ 않는다. Google OAuth 게시 심사에서도 확인한다.                 │
 * └──────────────────────────────────────────────────────────────┘
 */

/** 아직 채우지 않은 값. 화면에 그대로 보이므로 빠뜨리면 눈에 띈다. */
const TODO = (label: string) => `[확인 필요: ${label}]`;

export const LEGAL = {
  serviceName: 'MySoulMate',

  /**
   * 운영 주체. 법인이면 정식 상호, 개인이면 본인 이름.
   * 추측해서 채우지 않는다 — 법적 책임 주체를 잘못 적는 건 문서 전체를 무효로 만든다.
   */
  operatorName: TODO('운영자 이름 (예: 홍길동 (개인))'),

  /**
   * 서비스 주소.
   * `*.vercel.app` 로도 게시 심사를 받을 수 있지만 도메인 소유 확인이 안 돼서
   * 심사가 길어질 수 있다. 커스텀 도메인을 붙이면 이 값만 바꾸면 된다.
   */
  domain: TODO('서비스 도메인 (예: mysoulmate.kr)'),

  /** 개인정보 보호책임자. 1인 운영이면 본인이 맡는다. */
  cpo: {
    name: TODO('보호책임자 성명'),
    title: '운영자',
    /** 전화번호를 공개하기 어려우면 이메일 문의 창구만 두는 선택도 있다(변호사 검토 항목). */
    phone: TODO('연락 가능한 전화번호'),
    email: TODO('개인정보 문의 이메일'),
  },

  /** 우편으로 권리 행사 요청을 받을 주소. */
  mailingAddress: TODO('우편 주소'),

  /**
   * 개인정보가 실제로 보관되는 국가.
   * Supabase 프로젝트 리전에 따라 달라진다 — 대시보드 > Project Settings > General
   * 에서 확인한다. `ap-northeast-2` 면 대한민국(서울)이다.
   */
  storageCountry: TODO('Supabase 리전 국가 (예: 대한민국 또는 미국)'),

  /** 시행일. 개정할 때는 lastRevised 만 올리고 revisions 에 한 줄 추가한다. */
  effectiveDate: '2026-08-12',
  lastRevisedDate: '2026-08-12',
  revisions: [{ date: '2026-08-12', description: '개인정보 처리방침 제정' }],

  /** 이 서비스를 이용할 수 있는 최소 나이. */
  minimumAge: 14,
} as const;

/** 아직 확인이 필요한 값이 남아 있는지. 배포 전 점검에 쓴다. */
export function unresolvedLegalFields(): string[] {
  const found: string[] = [];
  const walk = (value: unknown, path: string) => {
    if (typeof value === 'string') {
      if (value.startsWith('[확인 필요:')) found.push(path);
      return;
    }
    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        walk(child, path ? `${path}.${key}` : key);
      }
    }
  };
  walk(LEGAL, '');
  return found;
}

/**
 * 개인정보 처리 위탁 현황.
 *
 * 수탁자의 이름·업무·국가는 법정 공개 항목이다(개인정보보호법 제26조, 제28조의8).
 * 새 외부 서비스를 붙일 때 여기에 한 줄을 더하는 걸 잊으면 방침이 사실과 어긋난다.
 */
export const PROCESSORS = [
  {
    name: 'Supabase, Inc.',
    task: '회원 정보·대화 기록 데이터베이스 운영, 로그인 인증, 이미지 저장',
    period: '위탁 계약 종료 또는 회원 탈퇴 시까지',
    country: LEGAL.storageCountry,
  },
  {
    name: 'Vercel, Inc.',
    task: '웹 서비스 호스팅 및 접속 로그 처리',
    period: '위탁 계약 종료 시까지',
    country: '미국',
  },
  {
    name: 'Google LLC',
    task: '대화 응답 및 캐릭터 이미지 생성 (Gemini API)',
    period: '요청 처리 시점에 한함',
    country: '미국',
  },
] as const;
