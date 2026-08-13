import Link from 'next/link';

/**
 * 법률 문서 조판.
 *
 * 업스트림 템플릿은 MDX 를 전제하지만 이 프로젝트에는 MDX 도 shadcn/ui 도 없다.
 * 정적 문서 두 장을 위해 그 의존성을 들이는 대신, 같은 내용을 프로젝트가 이미 쓰는
 * Tailwind 클래스로 짠다. 조판 규칙은 한곳에 모아 두 문서가 같은 모양을 갖게 한다.
 *
 * 장식을 넣지 않는다 — 이모지, 강조 색, 아이콘 없이 글자만 둔다.
 * 읽는 사람이 내용을 확인하러 오는 문서라 눈에 걸리는 게 없는 편이 낫다.
 */

export function LegalDoc({
  title,
  effectiveDate,
  lastRevisedDate,
  children,
}: {
  title: string;
  effectiveDate: string;
  lastRevisedDate?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="safe-page mx-auto w-full max-w-2xl px-6">
      <Link
        href="/"
        className="text-sm text-ink-soft underline-offset-4 hover:underline dark:text-cream/50"
      >
        ← 처음으로
      </Link>

      <h1 className="mt-6 text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-xs text-ink-soft dark:text-cream/50">
        시행일 {effectiveDate}
        {lastRevisedDate && ` · 최종 개정일 ${lastRevisedDate}`}
      </p>

      <div className="mt-10 space-y-6 text-[15px] leading-[1.85]">{children}</div>
    </main>
  );
}

/** 조 제목. */
export function Article({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mt-10 border-t border-black/10 pt-6 text-base font-semibold dark:border-white/15">
      {children}
    </h2>
  );
}

/** 조 안의 작은 제목. */
export function Sub({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-6 text-sm font-medium">{children}</h3>;
}

export function P({ children }: { children: React.ReactNode }) {
  return <p className="text-ink-soft dark:text-cream/70">{children}</p>;
}

export function List({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="ml-4 list-disc space-y-1.5 text-ink-soft dark:text-cream/70">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

/**
 * 표.
 *
 * 좁은 화면에서 표가 페이지 전체를 밀어내지 않도록 표만 따로 스크롤시킨다.
 * 위탁 현황이나 보유 기간은 열이 넉 개라 휴대폰에서 반드시 넘친다.
 */
export function Table({
  head,
  rows,
}: {
  head: string[];
  rows: React.ReactNode[][];
}) {
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full min-w-[34rem] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-black/15 dark:border-white/20">
            {head.map((h) => (
              <th key={h} className="px-2 py-2 font-medium whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="text-ink-soft dark:text-cream/70">
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-black/5 align-top dark:border-white/10">
              {row.map((cell, j) => (
                <td key={j} className="px-2 py-2.5">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
