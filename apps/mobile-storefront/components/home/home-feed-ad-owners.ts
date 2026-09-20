import { findHeroAdOwnerBlockId } from '@/components/storefront/hero-ad-owner';
import { findLaunchAdOwnerBlockId } from '@/components/storefront/launch-ad-owner';
import type { Block } from '@/types/blocks';
import { dedupeBlockIds } from './dedupe-block-ids';

export interface HomeFeedAdOwners {
  heroAdOwnerBlockId: string | null;
  launchAdOwnerBlockId: string | null;
}

export interface HomeFeedSlices extends HomeFeedAdOwners {
  footerBlocks: Block[];
  headerBlocks: Block[];
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

/**
 * Page-unique feed slices plus their elected ad owners. The CMS schema
 * does not enforce unique block IDs, so duplicates are qualified before
 * slicing — election, grants, and keys must agree on one identity per
 * block, or two slices sharing an ID would each claim the same logical
 * slot. Index-stable: slicing preserves block order and positions.
 */
export function getHomeFeedSlices({
  blocks,
  hasPrimaryGrid,
  primaryProductGridIndex,
}: {
  blocks: Block[];
  hasPrimaryGrid: boolean;
  primaryProductGridIndex: number;
}): HomeFeedSlices {
  const uniqueBlocks = dedupeBlockIds(blocks);
  const headerBlocks = hasPrimaryGrid
    ? uniqueBlocks.slice(0, primaryProductGridIndex)
    : uniqueBlocks;
  const footerBlocks = hasPrimaryGrid
    ? uniqueBlocks.slice(primaryProductGridIndex + 1)
    : [];
  const { heroAdOwnerBlockId, launchAdOwnerBlockId } = findHomeFeedAdOwners({
    footerBlocks,
    headerBlocks,
  });
  return {
    footerBlocks,
    headerBlocks,
    heroAdOwnerBlockId,
    launchAdOwnerBlockId,
  };
}
