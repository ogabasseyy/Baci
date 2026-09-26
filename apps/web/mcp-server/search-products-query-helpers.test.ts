import { describe, expect, it } from 'vitest';
import {
  getConditionPrefilterClauses,
  matchesConditionFamily,
  matchesRowConditionFamily,
} from './search-products-query-helpers';

describe('search-products condition helpers', () => {
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
