"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { placePopover } from "@/lib/popover";

/**
 * A tooltip rendered into <body> with fixed positioning, so it can never be
 * clipped by a scrolling or overflow-hidden container (charts, cards). It's
 * placed next to `anchor` (viewport coordinates) and flips/clamps to stay
 * fully on screen.
 */
export function FloatingTip({
  anchor,
  children,
  placement = "pointer",
  className = "",
}: {
  anchor: { x: number; y: number };
  children: ReactNode;
  /** "pointer": below-right of the point; "above": centred above it. */
  placement?: "pointer" | "above";
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const { x: ax, y: ay } = anchor;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (placement === "above") {
      const margin = 8;
      let top = ay - height - 8;
      if (top < margin) top = ay + 16; // no room above → below
      const left = Math.min(Math.max(margin, ax - width / 2), vw - margin - width);
      setPos({ left, top: Math.min(top, vh - margin - height) });
    } else {
      setPos(placePopover({ x: ax, y: ay }, { width, height }, { width: vw, height: vh }, { offset: 14, margin: 8 }));
    }
  }, [ax, ay, placement, children]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={ref}
      role="tooltip"
      className={`pointer-events-none fixed z-50 rounded-lg border border-line bg-raised/95 px-3 py-2 text-xs text-ink shadow-[var(--shadow-pop)] backdrop-blur ${className}`}
      style={pos ?? { left: -9999, top: -9999 }}
    >
      {children}
    </div>,
    document.body,
  );
}
