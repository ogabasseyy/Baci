import { describe, expect, it, vi } from 'vitest';
import {
  applyCategoryGraphicsPredicate,
  buildCategoryGraphicsJoin,
  normalizeCategoryGraphicsValue,
  normalizeCategoryGraphicsValues,
} from './category-page-graphics-query';

describe('normalizeCategoryGraphicsValue', () => {
  it('trims surrounding whitespace', () => {
    expect(normalizeCategoryGraphicsValue('  NVIDIA RTX 4070  ')).toBe(
      'NVIDIA RTX 4070'
    );
  });

  it('trims the same ASCII whitespace set as the Postgres backfill', () => {
    expect(normalizeCategoryGraphicsValue('\tNVIDIA RTX 4070\n')).toBe(
      'NVIDIA RTX 4070'
    );
    expect(normalizeCategoryGraphicsValue('\r\n\f\vRTX 4070\v\f\n\r')).toBe(
      'RTX 4070'
    );
  });

  it('leaves already-trimmed values untouched', () => {
    expect(normalizeCategoryGraphicsValue('Integrated Graphics')).toBe(
      'Integrated Graphics'
    );
  });
});

describe('normalizeCategoryGraphicsValues', () => {
  it('trims every value and drops empties', () => {
    expect(
      normalizeCategoryGraphicsValues([
        ' NVIDIA RTX 4070 ',
        '   ',
        'Integrated Graphics',
      ])
    ).toEqual(['NVIDIA RTX 4070', 'Integrated Graphics']);
  });

  it('returns an empty array for missing filters', () => {
    expect(normalizeCategoryGraphicsValues(undefined)).toEqual([]);
  });
});

describe('buildCategoryGraphicsJoin', () => {
  it('returns an empty fragment without a selection', () => {
    expect(buildCategoryGraphicsJoin([])).toBe('');
  });

  it('selects the gpu relation for a filtered read', () => {
    expect(buildCategoryGraphicsJoin(['NVIDIA RTX 4070'])).toBe(
      ', product_key_specs!inner(gpu)'
    );
  });
});

describe('applyCategoryGraphicsPredicate', () => {
  it('returns the query untouched without a selection', () => {
    const query = { in: vi.fn() };

    expect(applyCategoryGraphicsPredicate(query, [])).toBe(query);
    expect(query.in).not.toHaveBeenCalled();
  });

  it('applies the exact-match gpu predicate for a selection', () => {
    const query = { in: vi.fn() };

    expect(applyCategoryGraphicsPredicate(query, ['NVIDIA RTX 4070'])).toBe(
      query
    );
    expect(query.in).toHaveBeenCalledWith('product_key_specs.gpu', [
      'NVIDIA RTX 4070',
    ]);
  });
});
