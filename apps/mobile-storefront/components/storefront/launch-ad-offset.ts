/**
 * Keep the shopper's visible card stable when the sponsored slot appears or
 * disappears mid-scroll. The ad occupies index 1, so inserting or removing
 * it under a scrolled list shifts every later card by one slot width; moving
 * the content offset by the same delta keeps the visible product in place.
 * Returns null when no adjustment is needed.
 */
export function nextOffsetAfterAdToggle({
  adSlotWidth,
  isAdShown,
  scrollOffset,
  wasAdShown,
}: {
  adSlotWidth: number;
  isAdShown: boolean;
  scrollOffset: number;
  wasAdShown: boolean;
}): number | null {
  if (wasAdShown === isAdShown) return null;
  // At the start the insertion point sits offscreen right, so nothing the
  // shopper sees moves.
  if (scrollOffset <= 0) return null;
  const delta = isAdShown ? adSlotWidth : -adSlotWidth;
  return Math.max(0, scrollOffset + delta);
}
