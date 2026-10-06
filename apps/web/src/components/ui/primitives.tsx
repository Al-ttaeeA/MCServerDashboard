"use client";

import { useState, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

/**
 * Player face from mc-heads.net (a free, public skin renderer keyed by the
 * Mojang UUID). Falls back to a coloured initial if it can't load.
 */
export function Avatar({ uuid, name, color, size = 32 }: { uuid: string | null; name: string; color: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size };
  if (!uuid || failed) {
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center rounded-[4px] font-semibold text-bg"
        style={{ ...style, background: color, fontSize: size * 0.45 }}
        aria-hidden
      >
        {name.charAt(0).toUpperCase()}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static export, external avatar service
    <img
      src={`https://mc-heads.net/avatar/${uuid}/${Math.round(size * 2)}`}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
      className="shrink-0 rounded-[4px] [image-rendering:pixelated]"
      style={{ ...style, boxShadow: `0 0 0 1px ${color}55` }}
    />
  );
}

export function PlayerSwatch({ color, className = "size-2.5" }: { color: string; className?: string }) {
  return <span className={`inline-block shrink-0 rounded-[2px] ${className}`} style={{ background: color }} aria-hidden />;
}

export function OnlineBadge({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-2">
      <span className="live-dot size-2 rounded-full bg-good" aria-hidden />
      {compact ? <span className="sr-only">Online</span> : "Online"}
    </span>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton rounded-md ${className}`} aria-hidden />;
}

export function EmptyState({ icon = "info", title, children }: { icon?: IconName; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <span className="mb-1 rounded-lg border border-line bg-panel p-2.5 text-ink-3">
        <Icon name={icon} className="size-5" />
      </span>
      <p className="font-medium text-ink">{title}</p>
      {children ? <div className="max-w-md text-sm text-ink-2">{children}</div> : null}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <span className="rounded-lg border border-critical/40 bg-critical/10 p-2.5 text-critical">
        <Icon name="alert" className="size-5" />
      </span>
      <p className="font-medium">Couldn&apos;t load data</p>
      <p className="max-w-md text-sm text-ink-2">{error.message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 rounded-md border border-line bg-panel px-3 py-1.5 text-sm font-medium hover:border-ink-3 hover:bg-raised"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-[var(--radius-card)] border border-line-soft bg-panel/80 ${className}`}>{children}</div>;
}

export function Section({
  title,
  description,
  action,
  children,
  id,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section aria-labelledby={id ? `${id}-title` : undefined} id={id} className="scroll-mt-20">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id={id ? `${id}-title` : undefined} className="text-base font-semibold tracking-tight">
            {title}
          </h2>
          {description ? <p className="mt-0.5 text-sm text-ink-3">{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Stat tile: label · value · optional detail. Values use proportional figures (not tabular). */
export function StatTile({
  label,
  value,
  detail,
  icon,
  hero = false,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  icon?: IconName;
  hero?: boolean;
}) {
  return (
    <Card className="flex flex-col gap-1 p-4">
      <span className="flex items-center gap-1.5 text-xs text-ink-3">
        {icon ? <Icon name={icon} className="size-3.5" /> : null}
        {label}
      </span>
      <span className={hero ? "text-4xl font-semibold tracking-tight sm:text-5xl" : "text-xl font-semibold tracking-tight"}>{value}</span>
      {detail ? <span className="text-xs text-ink-3">{detail}</span> : null}
    </Card>
  );
}

/** Marks what kind of data a section shows: directly observed in logs, or derived from it. */
export function ProvenanceTag({ kind }: { kind: "observed" | "derived" }) {
  return (
    <span
      title={kind === "observed" ? "Read directly from server log lines" : "Calculated from logged events (e.g. sessions)"}
      className="rounded border border-line px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ink-3"
    >
      {kind}
    </span>
  );
}
