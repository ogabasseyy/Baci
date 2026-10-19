/**
 * Keep the shopper's visible card stable when the sponsored slot appears or
 * disappears mid-scroll. The ad occupies index 1, so inserting or removing
 * it shifts only the cards at or past the insertion offset (the first card's
 * end); moving the content offset by the same delta keeps the visible
 * product in place. Returns null when no adjustment is needed.
 */
export function nextOffsetAfterAdToggle({
  adSlotWidth,
  insertionOffset,
  isAdShown,
  scrollOffset,
  wasAdShown,
}: {
  adSlotWidth: number;
  insertionOffset: number;
  isAdShown: boolean;
  scrollOffset: number;
  wasAdShown: boolean;
}): number | null {
  if (wasAdShown === isAdShown) return null;
  // Before the insertion point nothing the shopper sees moves: a slightly
  // scrolled first card stays put, so applying a full slot delta would
  // abruptly jump the carousel forward (or snap it back on removal).
  if (scrollOffset < insertionOffset) return null;
  const delta = isAdShown ? adSlotWidth : -adSlotWidth;
  return Math.max(0, scrollOffset + delta);
}
