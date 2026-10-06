/**
 * Deterministic player colours.
 *
 * Each player gets a `color_index` when first seen (0, 1, 2, … in order of
 * first appearance), persisted in the database so it never changes between
 * syncs or deploys. The index maps to a fixed, validated palette.
 *
 * The palette is a categorical set validated for the dark surface: every
 * slot sits in the same lightness band, stays >= 3:1 against the background,
 * and adjacent slots remain distinguishable under protanopia/deuteranopia.
 * The *order* is part of that guarantee — don't reshuffle it.
 *
 * Beyond 8 players colours can no longer stay distinguishable, so extra
 * players share a neutral tone. Every timeline row is labelled with the
 * player's name, so identity never depends on colour alone.
 */

export const PLAYER_PALETTE = [
  "#3987e5", // blue
  "#d95926", // orange
  "#199e70", // aqua
  "#c98500", // yellow
  "#d55181", // magenta
  "#008300", // green
  "#9085e9", // violet
  "#e66767", // red
] as const;

export const OVERFLOW_PLAYER_COLOR = "#8b93a1";

export function playerColor(colorIndex: number): string {
  return PLAYER_PALETTE[colorIndex] ?? OVERFLOW_PLAYER_COLOR;
}

/** Next free palette slot given the slots already in use. */
export function nextColorIndex(used: Iterable<number>): number {
  const taken = new Set(used);
  let i = 0;
  while (taken.has(i)) i++;
  return i;
}
