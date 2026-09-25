import { describe, expect, it } from 'vitest';
import {
  getConditionPrefilterClauses,
  inferSmartphoneCategory,
  matchesConditionFamily,
  matchesRowConditionFamily,
} from './search-products-query-helpers';

describe('search-products condition helpers', () => {
  it('infers phones without reclassifying accessory or mixed-device searches', () => {
    expect(inferSmartphoneCategory('Redmi phones', undefined)).toBe('Smartphones');
    expect(inferSmartphoneCategory('phone under 300000', undefined)).toBe('Smartphones');
    expect(inferSmartphoneCategory('phone stand', undefined)).toBeUndefined();
    expect(inferSmartphoneCategory('smartphone mount', undefined)).toBeUndefined();
    expect(inferSmartphoneCategory('phones and tablets', undefined)).toBeUndefined();
    expect(inferSmartphoneCategory('Redmi phones', 'Accessories')).toBeUndefined();
  });

  it('keeps catalog condition prefilters as safe supersets', () => {
    expect(getConditionPrefilterClauses('open_box')).toEqual(
      expect.arrayContaining([
        'condition.eq.open_box',
        'condition.eq.refurbished',
        'available_conditions.cs.{open_box}',
        'available_conditions.cs.{refurbished}',
      ])
    );
    expect(getConditionPrefilterClauses('used')).toEqual(
      expect.arrayContaining([
        'condition.eq.used',
        'condition.eq.uk_used',
        'available_conditions.cs.{used}',
        'available_conditions.cs.{uk_used}',
        'has_condition_offers.eq.true',
      ])
    );
    expect(getConditionPrefilterClauses('bogus')).toEqual([]);
  });

  it('matches post-hydration condition metadata like the storefront filter', () => {
    expect(
      matchesConditionFamily(
        {
          available_conditions: ['new', 'open_box'],
          condition: 'new',
          has_condition_offers: false,
        },
        'open_box'
      )
    ).toBe(true);
    expect(
      matchesConditionFamily(
        {
          condition: 'new',
          has_condition_offers: true,
        },
        'used'
      )
    ).toBe(true);
  });

  it('can still check only the displayed row condition', () => {
    expect(
      matchesRowConditionFamily(
        {
          available_conditions: ['open_box'],
          condition: 'new',
        },
        'open_box'
      )
    ).toBe(false);
    expect(matchesRowConditionFamily({ condition: 'refurbished' }, 'open_box'))
      .toBe(true);
  });
});
