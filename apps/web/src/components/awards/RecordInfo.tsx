"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import type { AwardsResponse } from "@smp/core";
import { placePopover } from "@/lib/popover";
import { Icon } from "@/components/ui/Icon";
import { Avatar } from "@/components/ui/primitives";

type Record = AwardsResponse["records"][number];

const MEDALS = ["🥇", "🥈", "🥉"];

/**
 * Info button for a record: explains what the record measures and lists the
 * top 3 contenders. Opens on hover, keyboard focus, or tap (touch screens).
 * Rendered with fixed positioning so the card's overflow can't clip it.
 */
export function RecordInfo({ record }: { record: Record }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const id = useId();

  useLayoutEffect(() => {
    if (!open || !buttonRef.current || !tipRef.current) return;
    const b = buttonRef.current.getBoundingClientRect();
    const t = tipRef.current.getBoundingClientRect();
    setPos(placePopover({ x: b.left + b.width / 2, y: b.bottom }, { width: t.width, height: t.height }, { width: window.innerWidth, height: window.innerHeight }, { offset: 6 }));
  }, [open]);

  const show = () => setOpen(true);
  const hide = () => {
    setOpen(false);
    setPos(null);
  };

  return (
    <span className="inline-flex" onMouseEnter={show} onMouseLeave={hide}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={`About the ${record.title} record`}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onFocus={show}
        onBlur={hide}
        onClick={() => (open ? hide() : show())}
        onKeyDown={(e) => e.key === "Escape" && hide()}
        className="rounded-full p-0.5 text-ink-3 transition-colors hover:text-ink focus-visible:text-ink"
      >
        <Icon name="info" className="size-3.5" />
      </button>
      {open ? (
        <div
          ref={tipRef}
          id={id}
          role="tooltip"
          className="pop-in fixed z-50 w-72 rounded-lg border border-line bg-raised p-3 text-left font-normal normal-case tracking-normal text-ink shadow-[var(--shadow-pop)]"
          style={pos ?? { left: -9999, top: -9999 }}
        >
          <div className="flex items-center gap-1.5 text-sm font-semibold">
            <span aria-hidden>{record.emoji}</span>
            {record.title}
          </div>
          <p className="mt-1 text-xs text-ink-2">
            <span className="font-medium text-ink">{record.direction === "high" ? "Highest" : "Lowest"} on the server.</span> {record.description.replace(/`/g, "")}
          </p>
          {record.contenders.length ? (
            <>
              <div className="eyebrow mt-3">Top contenders</div>
              <ol className="mt-1.5 space-y-1.5">
                {record.contenders.map((c, i) => (
                  <li key={c.player.id} className="flex items-center gap-2 text-sm">
                    <span className="w-5 text-center" aria-label={`Rank ${i + 1}`}>
                      {MEDALS[i]}
                    </span>
                    <Avatar uuid={c.player.uuid} name={c.player.name} color={c.player.color} size={18} />
                    <span className="min-w-0 flex-1 truncate">{c.player.name}</span>
                    <span className="tabular shrink-0 font-medium">{c.formatted}</span>
                  </li>
                ))}
              </ol>
            </>
          ) : null}
        </div>
      ) : null}
    </span>
  );
}
