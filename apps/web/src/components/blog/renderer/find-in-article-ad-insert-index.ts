import type { TipTapNode } from './blog-tiptap-node';

/**
 * Finds the top-level block index after which a single mid-article ad should be
 * injected (after the 3rd non-empty paragraph on posts with >= 5 blocks, never
 * as the trailing element). Returns -1 when no mid-article slot should render.
 */
export function findInArticleAdInsertIndex(
  topLevelNodes: TipTapNode[] | undefined,
  hasAdSlot: boolean
): number {
  if (!hasAdSlot || !topLevelNodes || topLevelNodes.length < 5) {
    return -1;
  }

  let nonEmptyParagraphCount = 0;
  for (let i = 0; i < topLevelNodes.length; i += 1) {
    const candidate = topLevelNodes[i];
    if (
      candidate?.type === 'paragraph' &&
      candidate.content &&
      candidate.content.length > 0
    ) {
      nonEmptyParagraphCount += 1;
      if (nonEmptyParagraphCount === 3 && i < topLevelNodes.length - 1) {
        return i;
      }
    }
  }

  return -1;
}
