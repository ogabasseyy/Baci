import { describe, expect, it } from 'vitest';
import {
  isPreorder,
  LAUNCH_CAROUSEL_LIMIT,
  launchCtaLabel,
  OGABASSEY_PINNED_LAUNCH_SLUGS,
  selectLaunchProducts,
} from './launch-carousel';

interface TestProduct {
  slug?: string | null;
  name: string;
}

const p = (slug: string | null | undefined, name = slug ?? 'unnamed') => ({
  slug,
  name,
});

describe('selectLaunchProducts', () => {
  it('hoists pinned slugs to the front in pin order', () => {
    const items: TestProduct[] = [
      p('newest'),
      p('a27'),
      p('power80'),
      p('old'),
    ];

    const result = selectLaunchProducts(items, {
      pinned: ['power80', 'a27'],
    });

    expect(result.map((i) => i.slug)).toEqual([
      'power80',
      'a27',
      'newest',
      'old',
    ]);
  });

  it('keeps non-pinned items in their original (newest-first) input order', () => {
    const items: TestProduct[] = [p('b'), p('c'), p('a')];

    const result = selectLaunchProducts(items, { pinned: ['a'] });

    expect(result.map((i) => i.slug)).toEqual(['a', 'b', 'c']);
  });

  it('dedupes by slug, keeping the first occurrence', () => {
    const items: TestProduct[] = [
      p('a27', 'A27 first'),
      p('dup'),
      p('a27', 'A27 second'),
      p('dup'),
    ];

    const result = selectLaunchProducts(items, { pinned: ['a27'] });

    expect(result.map((i) => i.slug)).toEqual(['a27', 'dup']);
    expect(result[0].name).toBe('A27 first');
  });

  it('caps the result at the provided limit (pinned still win the slots)', () => {
    const items: TestProduct[] = [p('w1'), p('w2'), p('w3'), p('pin'), p('w4')];

    const result = selectLaunchProducts(items, { pinned: ['pin'], limit: 2 });

    expect(result.map((i) => i.slug)).toEqual(['pin', 'w1']);
  });

  it('skips pinned slugs that are absent from the input', () => {
    const items: TestProduct[] = [p('present')];

    const result = selectLaunchProducts(items, {
      pinned: ['missing', 'present'],
    });

    expect(result.map((i) => i.slug)).toEqual(['present']);
  });

  it('handles a pinned-first concat of [pinnedRows, windowRows] safely', () => {
    // Mirrors the real call: the targeted pinned fetch is prepended to the
    // recency window, then deduped — even when a pin also appears in the window.
    const pinnedRows: TestProduct[] = [
      p('iphone-duo'),
      p('redmi-note-17-pro-max-5g'),
    ];
    const windowRows: TestProduct[] = [
      p('redmi-note-17-pro-max-5g'),
      p('samsung-galaxy-z-flip8'),
      p('samsung-galaxy-s26-fe'),
      p('samsung-galaxy-a08'),
      p('iphone-18-pro-max'),
      p('macbook'),
    ];

    const result = selectLaunchProducts([...pinnedRows, ...windowRows], {
      pinned: OGABASSEY_PINNED_LAUNCH_SLUGS,
      limit: LAUNCH_CAROUSEL_LIMIT,
    });

    // All pins lead in pin order (redmi deduped from the window), capped at 6.
    expect(result.map((i) => i.slug)).toEqual([
      'iphone-duo',
      'samsung-galaxy-z-flip8',
      'samsung-galaxy-s26-fe',
      'samsung-galaxy-a08',
      'redmi-note-17-pro-max-5g',
      'iphone-18-pro-max',
    ]);
  });

  it('passes through rows without a slug instead of dropping them', () => {
    const items: TestProduct[] = [
      p('a'),
      p(null, 'no-slug'),
      p(undefined, 'also-none'),
    ];

    const result = selectLaunchProducts(items);

    expect(result.map((i) => i.name)).toEqual(['a', 'no-slug', 'also-none']);
  });

  it('does not dedupe distinct rows that both have null slugs', () => {
    const items: TestProduct[] = [
      p(null, 'first-no-slug'),
      p(null, 'second-no-slug'),
    ];

    const result = selectLaunchProducts(items);

    expect(result.map((i) => i.name)).toEqual([
      'first-no-slug',
      'second-no-slug',
    ]);
  });

  it('dedupes the same slug-less object appearing twice (by identity)', () => {
    const orphan = p(null, 'orphan');
    const result = selectLaunchProducts([orphan, orphan, p('a')]);

    expect(result.map((i) => i.name)).toEqual(['orphan', 'a']);
  });

  it('treats a negative or fractional limit as a floored, non-negative cap', () => {
    const items: TestProduct[] = [p('a'), p('b'), p('c')];

    // A negative limit must not slice from the end (slice(0, -1) would).
    expect(selectLaunchProducts(items, { limit: -1 })).toEqual([]);
    expect(
      selectLaunchProducts(items, { limit: 1.9 }).map((i) => i.slug)
    ).toEqual(['a']);
  });

  it('returns everything (uncapped) when no limit is given', () => {
    const items: TestProduct[] = [p('a'), p('b'), p('c')];

    expect(selectLaunchProducts(items)).toHaveLength(3);
  });
});

describe('isPreorder / launchCtaLabel', () => {
  it('detects pre-order names (with and without hyphen, case-insensitive)', () => {
    expect(isPreorder('Samsung Galaxy A27 5G Preorder')).toBe(true);
    expect(isPreorder('Pre-Order the new phone')).toBe(true);
    expect(isPreorder('Itel Power 80')).toBe(false);
  });

  it('labels the CTA based on pre-order status', () => {
    expect(launchCtaLabel('Samsung Galaxy A27 5G Preorder')).toBe(
      'Pre-order now'
    );
    expect(launchCtaLabel('Itel Power 80')).toBe('Shop now');
  });
});

describe('launch carousel constants', () => {
  it('keeps the carousel limit within the home schema slice (<= 8)', () => {
    expect(LAUNCH_CAROUSEL_LIMIT).toBeLessThanOrEqual(8);
  });

  it('pins the named launch devices led by iPhone Duo', () => {
    expect(OGABASSEY_PINNED_LAUNCH_SLUGS[0]).toBe('iphone-duo');
    expect(OGABASSEY_PINNED_LAUNCH_SLUGS).toContain('samsung-galaxy-z-flip8');
    expect(OGABASSEY_PINNED_LAUNCH_SLUGS).toContain('samsung-galaxy-s26-fe');
    expect(OGABASSEY_PINNED_LAUNCH_SLUGS).toContain('samsung-galaxy-a08');
    expect(OGABASSEY_PINNED_LAUNCH_SLUGS).toContain('redmi-note-17-pro-max-5g');
    expect(OGABASSEY_PINNED_LAUNCH_SLUGS).toContain('iphone-18-pro-max');
  });
});
