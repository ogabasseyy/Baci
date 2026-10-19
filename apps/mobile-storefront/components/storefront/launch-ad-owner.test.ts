import { describe, expect, it } from '@jest/globals';
import type { Block } from '@/types/blocks';
import { findLaunchAdOwnerBlockId } from './launch-ad-owner';

function launchBlock(id: string): Block {
  return { type: 'JustLaunched', props: { id } } as Block;
}

describe('findLaunchAdOwnerBlockId', () => {
  it('returns null when no launch block exists', () => {
    // Arrange & Act & Assert
    expect(findLaunchAdOwnerBlockId([])).toBeNull();
    expect(
      findLaunchAdOwnerBlockId([
        { type: 'HeroCarousel', props: { id: 'hero', slides: [] } } as Block,
      ])
    ).toBeNull();
  });

  it('selects the first launch block in visual order', () => {
    // Arrange & Act & Assert: a footer launch block must not shadow the
    // header one, or two banners would attribute to one logical slot.
    expect(
      findLaunchAdOwnerBlockId([
        launchBlock('header-launches'),
        launchBlock('footer-launches'),
      ])
    ).toBe('header-launches');
  });
});
