import { describe, expect, it } from 'vitest';
import {
  mergeAssuranceChoice,
  resolveAssuranceDefault,
} from './cart-assurance-policy';

describe('resolveAssuranceDefault', () => {
  it.each([
    { enableSmartCartPro: true, merchantSlug: 'ogabassey', expected: true },
    { enableSmartCartPro: false, merchantSlug: 'ogabassey', expected: false },
    { enableSmartCartPro: true, merchantSlug: 'other', expected: false },
    { enableSmartCartPro: true, merchantSlug: undefined, expected: false },
    { enableSmartCartPro: true, merchantSlug: null, expected: false },
  ])('defaults %$expected for %o', (fixture) => {
    expect(
      resolveAssuranceDefault({
        enableSmartCartPro: fixture.enableSmartCartPro,
        merchantSlug: fixture.merchantSlug,
      })
    ).toBe(fixture.expected);
  });
});

describe('mergeAssuranceChoice', () => {
  it.each([
    { incoming: true, stored: false, expected: true },
    { incoming: false, stored: true, expected: false },
    { incoming: undefined, stored: true, expected: true },
    { incoming: undefined, stored: false, expected: false },
    { incoming: undefined, stored: undefined, expected: undefined },
  ])('merges incoming=$incoming over stored=$stored', (fixture) => {
    expect(mergeAssuranceChoice(fixture.incoming, fixture.stored)).toBe(
      fixture.expected
    );
  });
});
