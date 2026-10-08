import { describe, expect, it } from 'vitest';
import {
  mergeAssuranceChoice,
  resolveAddedLineAssurance,
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

describe('resolveAddedLineAssurance', () => {
  const policy = { enableSmartCartPro: true, merchantSlug: 'ogabassey' };
  it.each([
    { incoming: true, existing: undefined, expected: true },
    { incoming: undefined, existing: undefined, expected: true },
    { incoming: false, existing: undefined, expected: false },
    {
      incoming: undefined,
      existing: { hasAssurance: false },
      expected: false,
    },
    { incoming: true, existing: { hasAssurance: false }, expected: true },
    { incoming: undefined, existing: {}, expected: undefined },
  ])('resolves incoming=$incoming existing=$existing', ({
    incoming,
    existing,
    expected,
  }) => {
    expect(resolveAddedLineAssurance(incoming, existing, policy)).toBe(
      expected
    );
  });
  it('falls back to opt-in for new lines off-policy', () => {
    expect(
      resolveAddedLineAssurance(undefined, undefined, {
        enableSmartCartPro: true,
        merchantSlug: 'other',
      })
    ).toBe(false);
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
