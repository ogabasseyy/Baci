import { describe, expect, it } from 'vitest';
import type { JumiaAttributeSetResponse } from '@/schemas/jumia/catalog';
import {
  serializeAttributeValue,
  serializeVariationValue,
  stableSourceValue,
} from './prepare-product-feed-values';

const definition = (
  type: JumiaAttributeSetResponse['attributes'][number]['type'],
  options?: JumiaAttributeSetResponse['attributes'][number]['options']
) => ({
  code: 1,
  name: 'Option',
  description: '',
  type,
  mandatory: false,
  variation: true,
  translatable: false,
  ...(options ? { options } : {}),
});

describe('Jumia preflight value serialization', () => {
  it('serializes supported scalar and active option variation values', () => {
    expect(serializeVariationValue(definition(0), 'Blue')).toEqual({
      draftValue: 'Blue',
      wireValue: 'Blue',
    });
    expect(serializeVariationValue(definition(2), '12')).toEqual({
      draftValue: 12,
      wireValue: '12',
    });
    expect(
      serializeVariationValue(
        definition(4, [
          {
            id: 5,
            sid: '00000000-0000-4000-8000-000000000005',
            name: 'Large',
            position: 1,
            isDefault: false,
            status: 'ACTIVE',
          },
        ]),
        'Large'
      )
    ).toEqual({ draftValue: 5, wireValue: 'Large' });
    expect(serializeVariationValue(definition(3), ['Blue'])).toBeNull();
  });

  it('serializes exact active single-select labels and rejects unknown options', () => {
    const options = [
      {
        id: 5,
        sid: '00000000-0000-4000-8000-000000000005',
        name: 'Large',
        position: 1,
        isDefault: false,
        status: 'ACTIVE' as const,
      },
      {
        id: 6,
        sid: '00000000-0000-4000-8000-000000000006',
        name: 'Old',
        position: 2,
        isDefault: false,
        status: 'INACTIVE' as const,
      },
    ];
    expect(serializeAttributeValue(definition(4, options), 5)).toBe('Large');
    expect(serializeAttributeValue(definition(4, options), 6)).toBeNull();
    expect(serializeAttributeValue(definition(3), 5)).toBeNull();
  });

  it('canonicalizes object key order while preserving array order', () => {
    expect(stableSourceValue({ z: 1, a: [2, 1] })).toBe(
      stableSourceValue({ a: [2, 1], z: 1 })
    );
    expect(stableSourceValue({ a: [2, 1] })).not.toBe(
      stableSourceValue({ a: [1, 2] })
    );
  });
});
