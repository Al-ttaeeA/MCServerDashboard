import type { StatIcon } from "@smp/core";

/** Small inline icon set (stroke icons, inherit currentColor). */
export type IconName = StatIcon | "users" | "chevron-left" | "chevron-right" | "reset" | "filter" | "x" | "table" | "alert" | "sword" | "arrow-right" | "check" | "info";

const PATHS: Record<IconName, string> = {
  clock: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  star: "m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3Z",
  skull: "M12 3a8 8 0 0 0-5 14.2V20a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-2.8A8 8 0 0 0 12 3Zm-3 9.5h.01M15 12.5h.01M10 21v-3m4 3v-3",
  trophy: "M8 21h8m-4-4v4m5-17h3v2a4 4 0 0 1-4 4M7 4H4v2a4 4 0 0 0 4 4m-1-6h10v6a5 5 0 0 1-10 0V4Z",
  flame: "M12 22a7 7 0 0 0 7-7c0-4-3-6-4-10-2 2-3 4-3 6-1-1-2-2-2-4-3 3-5 5-5 8a7 7 0 0 0 7 7Z",
  moon: "M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z",
  chat: "M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z",
  calendar: "M8 3v4m8-4v4M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z",
  bolt: "M13 2 4 14h7l-1 8 9-12h-7l1-8Z",
  users: "M16 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm13 9v-1a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
  "chevron-left": "m15 18-6-6 6-6",
  "chevron-right": "m9 18 6-6-6-6",
  reset: "M3 12a9 9 0 1 0 3-6.7L3 8m0-5v5h5",
  filter: "M3 5h18M6 12h12m-8 7h4",
  x: "M18 6 6 18M6 6l12 12",
  table: "M3 5h18v14H3V5Zm0 5h18M3 15h18M9 5v14",
  alert: "M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
  sword: "M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6m-3 3 4 4m-1-5 2 2",
  "arrow-right": "M5 12h14m-6-6 6 6-6 6",
  check: "M20 6 9 17l-5-5",
  info: "M12 16v-4m0-4h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z",
};

export function Icon({ name, className = "size-4", title }: { name: IconName; className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
    >
      {title ? <title>{title}</title> : null}
      <path d={PATHS[name]} />
    </svg>
  );
}
