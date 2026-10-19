import { describe, expect, it } from 'vitest';
import {
  canonicalHasLanes,
  canonicalIsGenericProjection,
  normalizeOptions,
} from './ucp-cart-recovery';

describe('normalizeOptions', () => {
  it('sorts keys so option order cannot change lane identity', () => {
    expect(normalizeOptions({ size: '9', color: 'red' })).toEqual(
      normalizeOptions({ color: 'red', size: '9' })
    );
    expect(normalizeOptions(null)).toBe('');
    expect(normalizeOptions(['a'])).toBe('');
  });
});

describe('canonicalHasLanes', () => {
  const canonical = {
    body: {
      line_items: [
        {
          item: {
            id: 'p1',
            variant_id: 'v1',
            condition: 'new',
            variant_attributes: { size: '9', color: 'red' },
          },
        },
      ],
    },
    status: 200,
  };
  it('matches lanes regardless of stored option order', () => {
    expect(
      canonicalHasLanes(canonical, [
        {
          productId: 'p1',
          variantId: 'v1',
          condition: 'new',
          options: { color: 'red', size: '9' },
        },
      ])
    ).toBe(true);
    expect(canonicalHasLanes(canonical, [{ productId: 'p2' }])).toBe(false);
  });
});

describe('canonicalIsGenericProjection', () => {
  it('treats enriched canonical lanes as a legitimate update, not a projection', () => {
    const canonical = {
      body: {
        line_items: [
          {
            item: {
              id: 'p1',
              variant_id: 'v1',
              variant_attributes: { color: 'red' },
              quantity: 2,
            },
          },
        ],
      },
      status: 200,
    };
    expect(
      canonicalIsGenericProjection(canonical, [
        { productId: 'p1', options: { color: 'red' }, quantity: 2 },
      ])
    ).toBe(false);
  });
  it('recognizes the bare create-time projection', () => {
    const canonical = {
      body: {
        line_items: [
          {
            item: {
              id: 'p1',
              variant_attributes: { color: 'red' },
              quantity: 2,
            },
          },
        ],
      },
      status: 200,
    };
    expect(
      canonicalIsGenericProjection(canonical, [
        { productId: 'p1', options: { color: 'red' }, quantity: 2 },
      ])
    ).toBe(true);
  });
});
