import type { Block } from '@/types/blocks';

/**
 * Qualifies duplicate block IDs with occurrence suffixes so every block on
 * the page has a stable unique identity for ad-owner election, placement
 * grants, and React keys. The CMS schema requires a nonempty ID but not
 * uniqueness, so two persisted blocks may legally share one; electing and
 * granting on the bare ID would let both claim the same logical slot
 * concurrently. First occurrences keep their bare ID and the input array
 * is returned untouched when IDs are already unique, so well-formed pages
 * render byte-identical with no new referential churn.
 */
export function dedupeBlockIds(blocks: Block[]): Block[] {
  const seen = new Map<string, number>();
  let hasDuplicates = false;
  for (const block of blocks) {
    const count = (seen.get(block.props.id) ?? 0) + 1;
    seen.set(block.props.id, count);
    if (count > 1) hasDuplicates = true;
  }
  if (!hasDuplicates) return blocks;
  const occurrence = new Map<string, number>();
  return blocks.map((block) => {
    const count = (occurrence.get(block.props.id) ?? 0) + 1;
    occurrence.set(block.props.id, count);
    if (count === 1) return block;
    // Only the string ID changes; the spread preserves the member shape,
    // but TS cannot correlate a generic union spread back to Block.
    return {
      ...block,
      props: { ...block.props, id: `${block.props.id}#__${count}` },
    } as Block;
  });
}
