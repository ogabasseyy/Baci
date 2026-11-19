import { describe, expect, it } from 'vitest';
import { effectiveLaunchPins } from './launch-carousel';

describe('effectiveLaunchPins', () => {
  const dp = (slug: string, created_at: string) => ({ slug, created_at });
  const CONFIGURED = ['a27', 'power80'];
  const SINCE = '2026-06-23T00:00:00.000Z';

  it('returns the configured pins unchanged when no candidate is newer than the cutoff', () => {
    const candidates = [
      dp('older', '2026-06-10T00:00:00Z'),
      dp('a27', '2026-06-22T00:00:00Z'),
    ];

    expect(effectiveLaunchPins(candidates, CONFIGURED, SINCE)).toEqual([
      'a27',
      'power80',
    ]);
  });

  it('does NOT let an existing product newer than the pins (but before the cutoff) outrank them', () => {
    // Regression: a recently-added laptop whose created_at is newer than the
    // pinned phones — but still before the pin-config cutoff — must not push the
    // pins back. (Previously the cutoff was the newest pin, so it did.)
    const candidates = [dp('laptop', '2026-06-22T23:58:00Z')];

    expect(effectiveLaunchPins(candidates, CONFIGURED, SINCE)).toEqual([
      'a27',
      'power80',
    ]);
  });

  it('hoists products created after the cutoff ahead of the pins, newest-first', () => {
    const candidates = [
      dp('added-second', '2026-06-24T00:00:00Z'),
      dp('added-latest', '2026-06-25T00:00:00Z'),
      dp('ancient', '2026-06-01T00:00:00Z'),
    ];

    expect(effectiveLaunchPins(candidates, CONFIGURED, SINCE)).toEqual([
      'added-latest',
      'added-second',
      'a27',
      'power80',
    ]);
  });

  it('ranks by creation time only, so a recently-edited older product never leads', () => {
    // An edit bumps updated_at, never created_at, so this stays behind the pins.
    const candidates = [dp('edited-old', '2026-05-01T00:00:00Z')];

    expect(effectiveLaunchPins(candidates, ['a27'], SINCE)).toEqual(['a27']);
  });

  it('skips already-pinned slugs and de-duplicates new arrivals', () => {
    const candidates = [
      dp('a27', '2026-06-30T00:00:00Z'),
      dp('newbie', '2026-06-25T00:00:00Z'),
      dp('newbie', '2026-06-25T00:00:00Z'),
    ];

    expect(effectiveLaunchPins(candidates, ['a27'], SINCE)).toEqual([
      'newbie',
      'a27',
    ]);
  });

  it('returns the configured pins unchanged when no cutoff is provided', () => {
    const candidates = [dp('newbie', '2026-06-25T00:00:00Z')];

    expect(effectiveLaunchPins(candidates, ['a27'], '')).toEqual(['a27']);
  });

  it('excludes non-device categories (batteries, power stations, cases, accessories) from auto-promoting ahead of pins', () => {
    const candidates = [
      {
        slug: 'itel-16kwh-battery',
        created_at: '2026-10-30T00:00:00Z',
        category: 'Lithium Batteries',
      },
      {
        slug: 'itel-power-tank',
        created_at: '2026-10-30T00:00:00Z',
        category: 'Portable Power Stations',
      },
      {
        slug: 'fold8-case',
        created_at: '2026-10-30T00:00:00Z',
        category: 'Accessories',
      },
      {
        slug: 'galaxy-s27-ultra',
        created_at: '2026-10-30T00:00:00Z',
        category: 'Smartphones',
      },
    ];

    expect(
      effectiveLaunchPins(
        candidates,
        ['iphone-duo'],
        '2026-10-29T00:00:00.000Z'
      )
    ).toEqual(['galaxy-s27-ultra', 'iphone-duo']);
  });

  it('matches hyphenated category slugs and joined categories/product_categories relations when legacy category is null', () => {
    const candidates = [
      {
        slug: 'ecoflow-delta',
        created_at: '2026-10-30T00:00:00Z',
        category: null,
        category_slug: 'power-stations',
      },
      {
        slug: 'privacy-glass',
        created_at: '2026-10-30T00:00:00Z',
        category: null,
        categories: { name: 'Screen Protectors', slug: 'screen-protectors' },
      },
      {
        slug: 'magsafe-battery',
        created_at: '2026-10-30T00:00:00Z',
        category: null,
        product_categories: [
          { categories: { name: 'Batteries', slug: 'batteries' } },
        ],
      },
      {
        slug: 'galaxy-z-fold9',
        created_at: '2026-10-30T00:00:00Z',
        category: null,
        product_categories: [
          { categories: { name: 'Smartphones', slug: 'smartphones' } },
        ],
      },
    ];

    expect(
      effectiveLaunchPins(
        candidates,
        ['iphone-duo'],
        '2026-10-29T00:00:00.000Z'
      )
    ).toEqual(['galaxy-z-fold9', 'iphone-duo']);
  });
});
