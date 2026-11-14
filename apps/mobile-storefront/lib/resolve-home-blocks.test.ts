import { describe, expect, it } from '@jest/globals';
import { resolveHomeBlocks } from './resolve-home-blocks';

describe('resolveHomeBlocks', () => {
  it('returns default storefront blocks when saved content is invalid', () => {
    const blocks = resolveHomeBlocks({ invalid: true }, false, false);

    expect(blocks.map((block) => block.type)).toEqual([
      'HeroCarousel',
      'JustLaunched',
      'CategoryRail',
      'ProductGrid',
    ]);
  });

  it('injects the just-launched carousel after the hero for a non-elite storefront', () => {
    const blocks = resolveHomeBlocks(
      [
        { type: 'HeroCarousel', props: { id: 'hero' } },
        { type: 'ProductGrid', props: { id: 'products' } },
      ],
      false,
      false
    );

    expect(blocks.map((block) => block.type)).toEqual([
      'HeroCarousel',
      'JustLaunched',
      'ProductGrid',
    ]);
  });

  it('does not duplicate a merchant-authored just-launched block', () => {
    const blocks = resolveHomeBlocks(
      [
        { type: 'HeroCarousel', props: { id: 'hero' } },
        { type: 'JustLaunched', props: { id: 'authored-launches' } },
        { type: 'ProductGrid', props: { id: 'products' } },
      ],
      false,
      false
    );

    expect(
      blocks
        .filter((block) => block.type === 'JustLaunched')
        .map((block) => block.props.id)
    ).toEqual(['authored-launches']);
  });

  it('inserts utility categories after an elite hero when absent', () => {
    const blocks = resolveHomeBlocks(
      [
        { type: 'HeroCarousel', props: { id: 'hero' } },
        { type: 'ProductGrid', props: { id: 'products' } },
      ],
      true,
      false
    );

    expect(blocks.map((block) => block.props.id)).toEqual([
      'hero',
      'forced-categories',
      'forced-just-launched',
      'products',
    ]);
  });

  it('keeps an existing elite category rail without injecting a duplicate', () => {
    const blocks = resolveHomeBlocks(
      [
        { type: 'HeroCarousel', props: { id: 'hero' } },
        { type: 'CategoryRail', props: { id: 'categories' } },
        { type: 'ProductGrid', props: { id: 'products' } },
      ],
      true,
      false
    );

    expect(
      blocks
        .filter((block) => block.type === 'CategoryRail')
        .map((block) => block.props.id)
    ).toEqual(['categories']);
  });

  it('places forced elite categories first when no hero is configured', () => {
    const blocks = resolveHomeBlocks(
      [{ type: 'ProductGrid', props: { id: 'products' } }],
      true,
      false
    );

    expect(blocks[0]?.props.id).toBe('forced-categories');
  });

  it('falls back to defaults for malformed persisted block properties', () => {
    const blocks = resolveHomeBlocks(
      [{ type: 'ProductGrid', props: null }],
      false,
      false
    );

    expect(blocks.map((block) => block.type)).toEqual([
      'HeroCarousel',
      'JustLaunched',
      'CategoryRail',
      'ProductGrid',
    ]);
  });

  it('falls back to defaults when a persisted block is missing props.id', () => {
    const blocks = resolveHomeBlocks(
      [{ type: 'ProductGrid', props: {} }],
      false,
      false
    );

    expect(blocks.map((block) => block.props.id)).toEqual([
      'default-hero',
      'default-just-launched',
      'default-categories',
      'default-products',
    ]);
  });

  it('withholds fallback blocks during the initial loading request', () => {
    expect(resolveHomeBlocks(undefined, false, true)).toEqual([]);
  });
  it('removes the wallet utility panel from Home but keeps shopping categories', () => {
    expect(
      resolveHomeBlocks(undefined, true, false, true).map((block) => block.type)
    ).not.toContain('CategoryRail');

    const blocks = resolveHomeBlocks(
      [
        { type: 'CategoryRail', props: { id: 'utilities', slug: 'utilities' } },
        { type: 'CategoryRail', props: { id: 'shopping', slug: 'phones' } },
      ],
      true,
      false,
      true
    );

    expect(
      blocks
        .filter((block) => block.type === 'CategoryRail')
        .map((block) => block.props.id)
    ).toEqual(['shopping']);
  });
});
