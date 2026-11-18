export interface SuggestionsRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Convert measured window coordinates into the portal host's local coordinates. */
export function addressSuggestionsPosition(
  anchor: SuggestionsRect,
  host: SuggestionsRect,
  keyboardTop: number | null
) {
  const gap = 4;
  const bottomLimit =
    Math.min(host.y + host.height, keyboardTop ?? Number.POSITIVE_INFINITY) - 8;
  const belowTop = anchor.y + anchor.height + gap;
  const availableBelow = bottomLimit - belowTop;
  const aboveBottom = Math.min(anchor.y, bottomLimit) - gap;
  const availableAbove = Math.max(0, aboveBottom - host.y);
  const above = availableBelow < 120 && availableAbove > availableBelow;
  const maxHeight = Math.max(
    0,
    Math.min(280, above ? availableAbove : availableBelow)
  );
  if (!maxHeight) return null;
  const width = Math.min(anchor.width, host.width);
  return {
    left: Math.max(0, Math.min(anchor.x - host.x, host.width - width)),
    width,
    maxHeight,
    // Anchor the actual bottom, not a guessed height: short lists stay attached.
    ...(above
      ? { bottom: host.height - (aboveBottom - host.y) }
      : { top: belowTop - host.y }),
  };
}

/** Make room below the field without pushing it above the visible viewport. */
export function addressSuggestionsScrollAmount(
  anchor: SuggestionsRect,
  host: SuggestionsRect,
  keyboardTop: number | null,
  contentHeight: number
) {
  const bottom =
    Math.min(host.y + host.height, keyboardTop ?? Number.POSITIVE_INFINITY) - 8;
  const required =
    anchor.y + anchor.height + 4 + Math.min(280, contentHeight) - bottom;
  return Math.max(0, Math.min(required, anchor.y - host.y - 8));
}
