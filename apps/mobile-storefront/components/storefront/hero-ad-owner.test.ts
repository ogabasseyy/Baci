import { describe, expect, it } from '@jest/globals';
import type { Block } from '@/types/blocks';
import { findHeroAdOwnerBlockId } from './hero-ad-owner';

function heroBlock(id: string, slideCount: number): Block {
  return {
    type: 'HeroCarousel',
    props: {
      id,
      slides: Array.from({ length: slideCount }, (_, index) => ({
        ctaLink: `/deals/${id}-${index}`,
        ctaText: 'Shop',
        image: `https://example.com/${id}-${index}.jpg`,
        subtitle: 'Available now',
        title: `${id} ${index}`,
      })),
    },
  } as Block;
}

describe('findHeroAdOwnerBlockId', () => {
  it('returns null when no hero has slides', () => {
    // Arrange & Act & Assert
    expect(findHeroAdOwnerBlockId([])).toBeNull();
    expect(findHeroAdOwnerBlockId([heroBlock('empty', 0)])).toBeNull();
    expect(
      findHeroAdOwnerBlockId([
        { type: 'JustLaunched', props: { id: 'launches' } } as Block,
      ])
    ).toBeNull();
  });

  it('selects the first eligible hero in visual order', () => {
    // Arrange & Act & Assert: an empty leading hero must not own the slot,
    // and a footer hero must not shadow the header one.
    expect(
      findHeroAdOwnerBlockId([
        heroBlock('empty', 0),
        heroBlock('header-hero', 1),
        heroBlock('footer-hero', 2),
      ])
    ).toBe('header-hero');
  });
});
