import { findHeroAdOwnerBlockId } from '@/components/storefront/hero-ad-owner';
import { findLaunchAdOwnerBlockId } from '@/components/storefront/launch-ad-owner';
import type { Block } from '@/types/blocks';

export interface HomeFeedAdOwners {
  heroAdOwnerBlockId: string | null;
  launchAdOwnerBlockId: string | null;
}

/**
 * Page-level ad-slot owners elected across the header/footer feed slices.
 * Each slice renders its own BlockRenderer, so a slice-local election would
 * let a header block and a footer block each claim the same logical slot
 * (HOME_STRIP for heroes, PRODUCT_GRID_MPU for launch carousels) and
 * request concurrently with split attribution.
 */
export function findHomeFeedAdOwners({
  footerBlocks,
  headerBlocks,
}: {
  footerBlocks: Block[];
  headerBlocks: Block[];
}): HomeFeedAdOwners {
  const pageBlocks = [...headerBlocks, ...footerBlocks];
  return {
    heroAdOwnerBlockId: findHeroAdOwnerBlockId(pageBlocks),
    launchAdOwnerBlockId: findLaunchAdOwnerBlockId(pageBlocks),
  };
}
