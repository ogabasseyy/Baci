import { describe, expect, it } from 'vitest';
import type { InternalRevalidateProductEntry } from '@/schemas/internal-revalidate-products-route';
import {
  buildPreviousCategoryPurgeEntries,
  collectPreviousCategoryIds,
} from './previous-category-purge-entries';

const entry = (
  overrides: Partial<InternalRevalidateProductEntry>
): InternalRevalidateProductEntry =>
  ({
    slug: null,
    id: null,
    category: null,
    categorySlug: null,
    previousCategoryId: null,
    ...overrides,
  }) as InternalRevalidateProductEntry;

describe('collectPreviousCategoryIds', () => {
  it('collects distinct, trimmed, non-blank previousCategoryId values', () => {
    expect(
      collectPreviousCategoryIds([
        entry({ id: 'p1', previousCategoryId: '  cat-a  ' }),
        entry({ id: 'p2', previousCategoryId: 'cat-a' }),
        entry({ id: 'p3', previousCategoryId: 'cat-b' }),
        entry({ id: 'p4', previousCategoryId: '   ' }),
        entry({ id: 'p5' }),
      ])
    ).toEqual(['cat-a', 'cat-b']);
  });

  it('returns an empty list when no entry carries a previousCategoryId', () => {
    expect(collectPreviousCategoryIds([entry({ slug: 'x' })])).toEqual([]);
  });
});

describe('buildPreviousCategoryPurgeEntries', () => {
  it('appends the old-segment purge when the resolved old slug differs from the current authoritative segment', () => {
    const result = buildPreviousCategoryPurgeEntries(
      [entry({ id: 'p1', previousCategoryId: 'cat-old' })],
      new Map([['cat-old', 'phones']]),
      new Map([['p1', 'smartphones']]),
      new Map([['p1', 'iphone-15']])
    );
    expect(result).toEqual([{ slug: 'iphone-15', categorySegment: 'phones' }]);
  });

  it('emits both current and previous slugs under the old category on combined slug and category moves', () => {
    const result = buildPreviousCategoryPurgeEntries(
      [
        entry({
          id: 'p1',
          slug: 'iphone-15-pro',
          previousSlug: 'iphone-15',
          categorySlug: 'smartphones',
          previousCategoryId: 'cat-old',
        }),
      ],
      new Map([['cat-old', 'phones']]),
      new Map([['p1', 'smartphones']]),
      new Map([['p1', 'iphone-15-pro']])
    );
    expect(result).toEqual([
      { slug: 'iphone-15-pro', categorySegment: 'phones' },
      { slug: 'iphone-15', categorySegment: 'phones' },
    ]);
  });

  it('resolves the current segment from flat hints when no authoritative segment is known', () => {
    const result = buildPreviousCategoryPurgeEntries(
      [
        entry({
          id: 'p1',
          slug: 'shoe',
          category: 'Sneakers',
          previousCategoryId: 'cat-old',
        }),
      ],
      new Map([['cat-old', 'boots']])
    );
    expect(result).toEqual([{ slug: 'shoe', categorySegment: 'boots' }]);
  });

  it('falls back to the product id as the slug for legacy null-slug rows', () => {
    const result = buildPreviousCategoryPurgeEntries(
      [entry({ id: 'prod-2', previousCategoryId: 'cat-old' })],
      new Map([['cat-old', 'audio']]),
      new Map([['prod-2', 'video']]),
      new Map()
    );
    expect(result).toEqual([{ slug: 'prod-2', categorySegment: 'audio' }]);
  });

  it('emits nothing when the product did not actually move (old segment === current segment)', () => {
    expect(
      buildPreviousCategoryPurgeEntries(
        [entry({ id: 'p1', slug: 'x', previousCategoryId: 'cat-old' })],
        new Map([['cat-old', 'audio']]),
        new Map([['p1', 'audio']])
      )
    ).toEqual([]);
  });

  it('emits nothing when the previousCategoryId cannot be resolved (fail-open lookup miss)', () => {
    expect(
      buildPreviousCategoryPurgeEntries(
        [entry({ id: 'p1', slug: 'x', previousCategoryId: 'cat-missing' })],
        new Map([['cat-old', 'audio']]),
        new Map([['p1', 'phones']])
      )
    ).toEqual([]);
  });

  it('skips entries without a previousCategoryId', () => {
    expect(
      buildPreviousCategoryPurgeEntries(
        [entry({ id: 'p1', slug: 'x' })],
        new Map([['cat-old', 'audio']])
      )
    ).toEqual([]);
  });

  it('skips entries that resolve to no slug or id', () => {
    expect(
      buildPreviousCategoryPurgeEntries(
        [entry({ previousCategoryId: 'cat-old' })],
        new Map([['cat-old', 'audio']])
      )
    ).toEqual([]);
  });
});
