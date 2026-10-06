/**
 * Places a floating card next to a point without leaving the viewport:
 * prefer below-right of the pointer, flip to the other side on overflow,
 * and finally clamp inside the margins.
 */
export function placePopover(
  anchor: { x: number; y: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  { offset = 12, margin = 12 } = {},
): { left: number; top: number } {
  let left = anchor.x + offset;
  if (left + size.width > viewport.width - margin) left = anchor.x - offset - size.width;
  let top = anchor.y + offset;
  if (top + size.height > viewport.height - margin) top = anchor.y - offset - size.height;
  left = Math.min(Math.max(margin, left), Math.max(margin, viewport.width - margin - size.width));
  top = Math.min(Math.max(margin, top), Math.max(margin, viewport.height - margin - size.height));
  return { left, top };
}
