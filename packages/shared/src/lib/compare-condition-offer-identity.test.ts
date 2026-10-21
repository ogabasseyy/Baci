import { describe, expect, it } from 'vitest';
import { compareConditionOfferIdentity } from './compare-condition-offer-identity';

describe('compareConditionOfferIdentity', () => {
  it('orders by raw condition, then id, in code units', () => {
    // Hyphen sorts before underscore in code units ('-' < '_');
    // localeCompare may ignore or reorder punctuation by locale.
    expect(
      compareConditionOfferIdentity(
        { condition: 'a-b', id: 'x' },
        { condition: 'a_b', id: 'x' }
      )
    ).toBeLessThan(0);
    expect(
      compareConditionOfferIdentity(
        { condition: 'open_box', id: 'offer-zzz' },
        { condition: 'refurbished', id: 'offer-aaa' }
      )
    ).toBeLessThan(0);
    expect(
      compareConditionOfferIdentity(
        { condition: 'used', id: 'offer-aaa' },
        { condition: 'used', id: 'offer-zzz' }
      )
    ).toBeLessThan(0);
  });

  it('compares ids as lowercase hex, matching uuid byte order', () => {
    expect(compareConditionOfferIdentity({ id: 'AAA' }, { id: 'aaa' })).toBe(0);
    expect(
      compareConditionOfferIdentity(
        { id: '00000000-0000-4000-8000-00000000000A' },
        { id: '00000000-0000-4000-8000-00000000000a' }
      )
    ).toBe(0);
    expect(
      compareConditionOfferIdentity(
        { id: '00000000-0000-4000-8000-000000000009' },
        { id: '00000000-0000-4000-8000-00000000000A' }
      )
    ).toBeLessThan(0);
  });
});
