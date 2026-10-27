import { describe, expect, it } from 'vitest';
import { comparisonSnapshotSchema } from '@/schemas/comparison-snapshot';
import {
  COMPARISON_SNAPSHOT_KEYS,
  SNAPSHOT_CONDITIONS,
  parseComparisonSnapshot,
} from './parse-comparison-snapshot';

const snapshot = {
  id: 'p1',
  name: 'Phone',
  price: '$100',
  image: '/phone.jpg',
  description: '',
};

const VALID_CASES = [
  { ...snapshot },
  { ...snapshot, slug: 'phone', extraField: 'drop-me' },
  { ...snapshot, brand: 'Acme', condition: 'used' },
  { ...snapshot, condition: 'bogus' },
  {
    ...snapshot,
    matchVariantId: '11111111-1111-4111-8111-111111111111',
    matchOfferId: '22222222-2222-4222-8222-222222222222',
    matchCondition: 'open_box',
  },
  {
    ...snapshot,
    matchVariantId: 'not-a-uuid',
    matchOfferId: '22222222-2222-4222-8222-222222222222',
    matchCondition: 'hand-edited',
  },
  { ...snapshot, id: '  p1-trimmed  ', name: '  Trimmed Name  ' },
  { ...snapshot, id: 42, rawPrice: 0 },
  { ...snapshot, rawPrice: 250000.5 },
  { ...snapshot, merchantId: 'm1', category: 'Tech', categorySlug: 'tech' },
  { ...snapshot, brand: undefined, slug: undefined, rawPrice: undefined },
  { ...snapshot, categories: { id: 'c1', name: 'Phones', slug: 'phones', extra: 1 } },
  { ...snapshot, categories: { id: 'c1', name: 'Phones' } },
  { ...snapshot, categories: { id: 'c1', name: 'Phones', slug: undefined } },
  { ...snapshot, matchVariantId: undefined, matchOfferId: undefined },
];

const INVALID_CASES = [
  null, undefined, 'string', 123, [], {},
  { id: 'p1' },
  { ...snapshot, name: undefined },
  { ...snapshot, name: 42 },
  { ...snapshot, name: '' },
  { ...snapshot, name: '   ' },
  { ...snapshot, id: '' },
  { ...snapshot, id: '   ' },
  { ...snapshot, id: Number.POSITIVE_INFINITY },
  { ...snapshot, id: Number.NaN },
  { ...snapshot, price: 100 },
  { ...snapshot, image: false },
  { ...snapshot, description: null },
  { ...snapshot, slug: {} },
  { ...snapshot, brand: 42 },
  { ...snapshot, rawPrice: -1 },
  { ...snapshot, rawPrice: Number.NaN },
  { ...snapshot, categories: { name: 42 } },
  { ...snapshot, categories: { id: 'c1' } },
  { ...snapshot, categories: { id: 'c1', name: 'P', slug: 42 } },
  { ...snapshot, categories: null },
  { ...snapshot, categories: [] },
];

function getConditionEnumOptions(): readonly string[] {
  let current: { _def?: { innerType?: unknown }; options?: readonly string[] } =
    comparisonSnapshotSchema.shape.condition;
  while (current._def?.innerType) {
    current = current._def.innerType as {
      _def?: { innerType?: unknown };
      options?: readonly string[];
    };
  }
  return current.options ?? [];
}

describe('parseComparisonSnapshot parity with comparisonSnapshotSchema', () => {
  it.each(VALID_CASES)('matches zod for valid input %#', (input) => {
    const zod = comparisonSnapshotSchema.safeParse(input);
    expect(zod.success).toBe(true);
    expect(parseComparisonSnapshot(input)).toEqual(zod.data);
  });

  it.each(INVALID_CASES)('matches zod rejection for invalid input %#', (input) => {
    const zod = comparisonSnapshotSchema.safeParse(input);
    expect(zod.success).toBe(false);
    expect(parseComparisonSnapshot(input)).toBeNull();
  });

  it('mirrors comparisonSnapshotSchema keys and conditions via introspection', () => {
    expect([...COMPARISON_SNAPSHOT_KEYS].sort()).toEqual(
      Object.keys(comparisonSnapshotSchema.shape).sort()
    );
    const schemaConditions = getConditionEnumOptions();
    expect(schemaConditions.length).toBeGreaterThan(0);
    expect([...SNAPSHOT_CONDITIONS].sort()).toEqual(
      [...schemaConditions].sort()
    );
    for (const cond of schemaConditions) {
      expect(parseComparisonSnapshot({ ...snapshot, condition: cond })).toEqual(
        comparisonSnapshotSchema.parse({ ...snapshot, condition: cond })
      );
      expect(parseComparisonSnapshot({ ...snapshot, matchCondition: cond })).toEqual(
        comparisonSnapshotSchema.parse({ ...snapshot, matchCondition: cond })
      );
    }
  });

  it('preserves parity with the schema test cases', () => {
    expect(
      parseComparisonSnapshot({ ...snapshot, slug: 'phone', variants: [{}] })
    ).toEqual({ ...snapshot, slug: 'phone' });
    expect(
      parseComparisonSnapshot({ ...snapshot, brand: 'Acme', condition: 'used' })
    ).toEqual({ ...snapshot, brand: 'Acme', condition: 'used' });
    expect(
      parseComparisonSnapshot({ ...snapshot, condition: 'bogus' })
    ).toEqual({ ...snapshot, condition: undefined });
    expect(
      parseComparisonSnapshot({
        ...snapshot,
        matchVariantId: '11111111-1111-4111-8111-111111111111',
        matchOfferId: '22222222-2222-4222-8222-222222222222',
        matchCondition: 'open_box',
      })
    ).toEqual({
      ...snapshot,
      matchVariantId: '11111111-1111-4111-8111-111111111111',
      matchOfferId: '22222222-2222-4222-8222-222222222222',
      matchCondition: 'open_box',
    });
    expect(
      parseComparisonSnapshot({
        ...snapshot,
        matchVariantId: 'not-a-uuid',
        matchOfferId: '22222222-2222-4222-8222-222222222222',
        matchCondition: 'hand-edited',
      })
    ).toEqual({
      ...snapshot,
      matchVariantId: undefined,
      matchOfferId: '22222222-2222-4222-8222-222222222222',
      matchCondition: undefined,
    });
  });
});
