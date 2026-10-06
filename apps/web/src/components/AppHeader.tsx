"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { MetaResponse } from "@smp/core";
import { useApi } from "@/lib/api";
import { formatDateTime, formatRelative } from "@/lib/format";

const NAV = [
  { href: "/", label: "Timeline" },
  { href: "/awards/", label: "Awards" },
  { href: "/leaderboards/", label: "Leaderboards" },
];

/** A 3×3 block mark: the logo, drawn rather than imported. */
function LogoMark() {
  const cells = [1, 0.55, 1, 0.55, 0.25, 0.55, 1, 0.55, 1];
  return (
    <span className="grid size-5 grid-cols-3 gap-[2px]" aria-hidden>
      {cells.map((o, i) => (
        <span key={i} className="rounded-[1px] bg-accent" style={{ opacity: o }} />
      ))}
    </span>
  );
}

export function AppHeader() {
  const pathname = usePathname();
  const meta = useApi<MetaResponse>("/meta");
  const online = meta.data?.onlinePlayerIds.length ?? 0;
  const updated = meta.data?.lastSuccessfulSyncAt;

  return (
    <header className="sticky top-0 z-30 border-b border-line-soft bg-bg/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-3 px-4 sm:gap-6 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2.5">
          <LogoMark />
          <span className="text-sm font-semibold tracking-[0.14em]">
            SMP<span className="hidden text-ink-3 sm:inline"> ANALYTICS</span>
          </span>
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1">
          {NAV.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href.replace(/\/$/, ""));
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                  active ? "bg-raised text-ink" : "text-ink-2 hover:bg-panel hover:text-ink"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-4 whitespace-nowrap text-xs text-ink-3">
          {online > 0 ? (
            <span className="hidden items-center gap-1.5 text-ink-2 sm:inline-flex">
              <span className="live-dot size-2 rounded-full bg-good" aria-hidden />
              {online} online
            </span>
          ) : null}
          {updated ? (
            <span title={`Last synced ${formatDateTime(updated)}`}>
              <span className="hidden sm:inline">Last updated </span>
              {formatRelative(updated)}
            </span>
          ) : meta.status === "error" ? (
            <span className="text-critical">API unreachable</span>
          ) : null}
        </div>
      </div>
    </header>
  );
}
