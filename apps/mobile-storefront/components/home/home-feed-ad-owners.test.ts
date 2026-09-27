import { describe, expect, it } from '@jest/globals';
import type { Block } from '@/types/blocks';
import { findHomeFeedAdOwners } from './home-feed-ad-owners';

function heroBlock(id: string): Block {
  return {
    type: 'HeroCarousel',
    props: {
      id,
      slides: [
        {
          ctaLink: '/deals',
          ctaText: 'Shop',
          image: `https://example.com/${id}.jpg`,
          subtitle: 'Available now',
          title: id,
        },
      ],
    },
  } as Block;
}

function launchBlock(id: string): Block {
  return { type: 'JustLaunched', props: { id } } as Block;
}

describe('findHomeFeedAdOwners', () => {
  it('returns null owners when the page has no ad blocks', () => {
    // Arrange & Act & Assert
    expect(
      findHomeFeedAdOwners({ footerBlocks: [], headerBlocks: [] })
    ).toEqual({ heroAdOwnerBlockId: null, launchAdOwnerBlockId: null });
  });

  it('elects one owner per slot across both slices', () => {
    // Arrange & Act & Assert: a footer hero or launch block must not
    // shadow the header one, or two banners would attribute to one slot.
    expect(
      findHomeFeedAdOwners({
        footerBlocks: [heroBlock('footer-hero'), launchBlock('footer-launch')],
        headerBlocks: [heroBlock('header-hero'), launchBlock('header-launch')],
      })
    ).toEqual({
      heroAdOwnerBlockId: 'header-hero',
      launchAdOwnerBlockId: 'header-launch',
    });
  });
});
