import type { Block, JustLaunchedBlock } from '@/types/blocks';

/**
 * Single PRODUCT_GRID_MPU owner across the whole page. The feed renders one
 * BlockRenderer per slice (header/footer), so each slice cannot elect its
 * own owner: two launch blocks on opposite sides of the product grid would
 * each claim the placement and request the same logical slot concurrently.
 * Returns the first launch block in visual order, or null.
 */
export function findLaunchAdOwnerBlockId(blocks: Block[]): string | null {
  for (const block of blocks) {
    if (block.type !== 'JustLaunched') continue;
    return (block as JustLaunchedBlock).props.id;
  }
  return null;
}
