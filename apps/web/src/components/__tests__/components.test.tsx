// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Award, PlayerSummaryDto } from "@smp/core";
import { PlayerPopover } from "../timeline/PlayerPopover";
import { TimelineToolbar } from "../timeline/TimelineToolbar";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

function award(metricId: string, title: string, emoji: string, line: string): Award {
  return { metricId, title, emoji, line, direction: "high", value: 1, formatted: "1", explanation: `${title} explanation`, percentile: 100, median: 1, ratioToMedian: 2, score: 0.8 };
}

const player: PlayerSummaryDto = {
  id: "11111111-2222-4333-8444-555555555555",
  name: "Alex",
  uuid: null,
  color: "#3987e5",
  firstSeen: "2026-10-01T10:00:00Z",
  lastSeen: "2026-10-05T10:00:00Z",
  online: false,
  playtimeSeconds: 127 * 3600 + 42 * 60,
  sessionCount: 40,
  awards: [
    award("longest_session", "The Marathon", "🏃", "8h 14m longest session"),
    award("night_share", "The Night Shift", "🌙", "71% late-night play"),
    award("diamond_ore", "The Diamond Goblin", "💎", "2,431 diamond ore mined"),
  ],
};

describe("PlayerPopover", () => {
  it("shows playtime, three awards and a link to the full profile", () => {
    render(<PlayerPopover player={player} anchor={{ x: 10, y: 10 }} onClose={() => {}} />);
    expect(screen.getByRole("dialog", { name: "Alex summary" })).toBeTruthy();
    expect(screen.getByText("127h 42m")).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("The Night Shift")).toBeTruthy();
    expect(screen.getByText("2,431 diamond ore mined")).toBeTruthy();
    expect(screen.getByRole("link", { name: /view all stats/i }).getAttribute("href")).toBe("/player/?name=Alex");
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<PlayerPopover player={player} anchor={{ x: 10, y: 10 }} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});

describe("TimelineToolbar", () => {
  const players = [
    { id: "a", name: "Alex", uuid: null, color: "#3987e5" },
    { id: "b", name: "Bea", uuid: null, color: "#d95926" },
  ];
  const setup = (hidden = new Set<string>()) => {
    const props = {
      activePreset: "7d" as const,
      onPreset: vi.fn(),
      onCustomRange: vi.fn(),
      players,
      hidden,
      onToggle: vi.fn(),
      onShowAll: vi.fn(),
      showTable: false,
      onToggleTable: vi.fn(),
    };
    render(<TimelineToolbar {...props} />);
    return props;
  };

  it("marks the active preset and switches ranges", () => {
    const props = setup();
    expect(screen.getByRole("button", { name: "7d" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "30d" }));
    expect(props.onPreset).toHaveBeenCalledWith("30d");
  });

  it("toggles player visibility from the Players menu", () => {
    const props = setup(new Set(["b"]));
    fireEvent.click(screen.getByRole("button", { name: /players/i }));
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes.map((b) => b.checked)).toEqual([true, false]);
    fireEvent.click(boxes[1]!);
    expect(props.onToggle).toHaveBeenCalledWith("b");
  });

  it("Reset zoom shows everything", () => {
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: /reset zoom/i }));
    expect(props.onPreset).toHaveBeenCalledWith("all");
  });
});
