import type { Award } from "@smp/core";

/** Compact award row for cards: emoji, title in small caps, one-line stat. */
export function AwardLine({ award }: { award: Award }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-panel text-base leading-none" aria-hidden>
        {award.emoji}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-ink">{award.title}</span>
        <span className="block text-xs text-ink-2">{award.line}</span>
      </span>
    </li>
  );
}

/** Full award card for the profile page. */
export function AwardCard({ award, rank }: { award: Award; rank?: number }) {
  return (
    <article className="relative flex h-full flex-col gap-2 overflow-hidden rounded-[var(--radius-card)] border border-line-soft bg-panel/80 p-5">
      <div className="pointer-events-none absolute -right-3 -top-4 select-none text-7xl opacity-[0.07]" aria-hidden>
        {award.emoji}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-2xl leading-none" aria-hidden>
          {award.emoji}
        </span>
        {rank !== undefined ? <span className="eyebrow">Award {rank}</span> : null}
      </div>
      <h3 className="text-sm font-bold uppercase tracking-[0.1em]">{award.title}</h3>
      <p className="text-lg font-semibold tracking-tight">{award.line}</p>
      <p className="text-sm text-ink-2">{award.explanation}</p>
      <div className="mt-auto flex flex-wrap gap-1.5 pt-2 text-[11px] text-ink-3">
        <Chip>{ordinal(award.percentile)} percentile</Chip>
        {award.ratioToMedian !== null && award.ratioToMedian >= 1.15 ? <Chip>{award.ratioToMedian}× server median</Chip> : null}
        {award.ratioToMedian !== null && award.ratioToMedian <= 0.87 ? <Chip>{Math.round(award.ratioToMedian * 100)}% of server median</Chip> : null}
      </div>
    </article>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full border border-line px-2 py-0.5">{children}</span>;
}

export function ordinal(n: number): string {
  const r = Math.round(n);
  const s = r % 100 >= 11 && r % 100 <= 13 ? "th" : r % 10 === 1 ? "st" : r % 10 === 2 ? "nd" : r % 10 === 3 ? "rd" : "th";
  return `${r}${s}`;
}
