import { describe, expect, it } from 'vitest';
import { getGeneralKeySpecCategoryProjection } from './general-key-spec-category-projection';

describe('getGeneralKeySpecCategoryProjection', () => {
  it('returns public general hardware fields without phone capabilities', () => {
    const fieldKeys = getGeneralKeySpecCategoryProjection()
      .flatMap((category) => category.fields)
      .map((field) => field.key);

    expect(fieldKeys).toEqual(
      expect.arrayContaining([
        'chipset',
        'gpu',
        'storage_gb',
        'display_ppi',
        'card_slot_type',
      ])
    );
    expect(fieldKeys).not.toEqual(
      expect.arrayContaining(['has_5g', 'has_nfc', 'sim_type'])
    );
  });
});
