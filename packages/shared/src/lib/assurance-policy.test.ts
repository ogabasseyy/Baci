import { describe, expect, it } from 'vitest';
import {
  resolveAddedLineAssurance,
  resolveAssuranceDefault,
  resolveAssuranceLabel,
  resolveAssuranceMerchantSetting,
  shouldDeferAssuranceDefault,
} from './assurance-policy';

describe('resolveAddedLineAssurance', () => {
  const policy = {
    smartCartProEnabled: true,
    merchantSlug: 'ogabassey',
    shippingInsuranceEnabled: true,
  };
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
  it.each([
    {
      policy: { smartCartProEnabled: false, merchantSlug: 'ogabassey' },
      expected: false,
    },
    {
      policy: { smartCartProEnabled: true, merchantSlug: 'other' },
      expected: false,
    },
    {
      policy: { smartCartProEnabled: true, merchantSlug: undefined },
      expected: false,
    },
    {
      policy: { smartCartProEnabled: true, merchantSlug: null },
      expected: false,
    },
  ])('falls back to opt-in for new lines off-policy: %o', (fixture) => {
    expect(
      resolveAddedLineAssurance(undefined, undefined, fixture.policy)
    ).toBe(fixture.expected);
  });
  it.each([
    'Ogabassey',
    'OGABASSEY',
    'oGaBaSsEy',
  ])('matches the Ogabassey default case-insensitively: %s', (merchantSlug) => {
    expect(
      resolveAddedLineAssurance(undefined, undefined, {
        smartCartProEnabled: true,
        merchantSlug,
        shippingInsuranceEnabled: true,
      })
    ).toBe(true);
  });
  it.each([
    { incoming: undefined, existing: undefined, expected: false },
    {
      incoming: undefined,
      existing: { hasAssurance: true },
      expected: false,
    },
    { incoming: true, existing: undefined, expected: true },
    { incoming: false, existing: { hasAssurance: true }, expected: false },
  ])('forces voucher lines to opt out without an explicit choice: %o', ({
    incoming,
    existing,
    expected,
  }) => {
    expect(
      resolveAddedLineAssurance(incoming, existing, {
        ...policy,
        hasQuizVoucher: true,
      })
    ).toBe(expected);
  });
  it.each([
    { incoming: undefined, existing: undefined, expected: false },
    { incoming: true, existing: undefined, expected: true },
    { incoming: false, existing: undefined, expected: false },
    {
      incoming: undefined,
      existing: { hasAssurance: true },
      expected: true,
    },
  ])('never defaults new lines on when insurance is disabled: %o', ({
    incoming,
    existing,
    expected,
  }) => {
    expect(
      resolveAddedLineAssurance(incoming, existing, {
        ...policy,
        shippingInsuranceEnabled: false,
      })
    ).toBe(expected);
  });
  it('keeps the default when insurance is affirmatively enabled', () => {
    expect(
      resolveAddedLineAssurance(undefined, undefined, {
        ...policy,
        shippingInsuranceEnabled: true,
      })
    ).toBe(true);
  });
  it.each([
    undefined,
    false,
  ])('fails new lines to opt-out when insurance is unknown or disabled: %s', (shippingInsuranceEnabled) => {
    expect(
      resolveAddedLineAssurance(undefined, undefined, {
        ...policy,
        shippingInsuranceEnabled,
      })
    ).toBe(false);
  });
});

describe('resolveAssuranceDefault', () => {
  it('defaults on only with the flag, the slug, and an affirmative setting', () => {
    expect(
      resolveAssuranceDefault({
        smartCartProEnabled: true,
        merchantSlug: 'ogabassey',
        shippingInsuranceEnabled: true,
      })
    ).toBe(true);
  });

  it.each([
    {
      label: 'flag off',
      policy: {
        smartCartProEnabled: false,
        merchantSlug: 'ogabassey',
        shippingInsuranceEnabled: true,
      },
    },
    {
      label: 'other slug',
      policy: {
        smartCartProEnabled: true,
        merchantSlug: 'another-store',
        shippingInsuranceEnabled: true,
      },
    },
    {
      label: 'unknown setting',
      policy: {
        smartCartProEnabled: true,
        merchantSlug: 'ogabassey',
        shippingInsuranceEnabled: undefined,
      },
    },
    {
      label: 'disabled setting',
      policy: {
        smartCartProEnabled: true,
        merchantSlug: 'ogabassey',
        shippingInsuranceEnabled: false,
      },
    },
  ])('stays off when $label', ({ policy }) => {
    expect(resolveAssuranceDefault(policy)).toBe(false);
  });
});

describe('resolveAssuranceMerchantSetting', () => {
  it.each([
    {
      label: 'matching slugs pass the live setting through',
      input: {
        contextSlug: 'ogabassey',
        contextSetting: true,
        cartSlug: 'ogabassey',
      },
      expected: true,
    },
    {
      label: 'mismatched slugs force the setting off',
      input: {
        contextSlug: 'another-store',
        contextSetting: true,
        cartSlug: 'ogabassey',
      },
      expected: false,
    },
    {
      label: 'casing-only slug differences pass the setting through',
      input: {
        contextSlug: 'ogabassey',
        contextSetting: true,
        cartSlug: 'Ogabassey',
      },
      expected: true,
    },
    {
      label: 'an unknown context setting stays unknown',
      input: {
        contextSlug: 'ogabassey',
        contextSetting: undefined,
        cartSlug: 'ogabassey',
      },
      expected: undefined,
    },
    {
      label: 'a missing cart slug does not force anything off',
      input: {
        contextSlug: 'ogabassey',
        contextSetting: true,
        cartSlug: null,
      },
      expected: true,
    },
    {
      label: 'a missing context slug passes the setting through',
      input: {
        contextSlug: null,
        contextSetting: true,
        cartSlug: 'ogabassey',
      },
      expected: true,
    },
  ])('$label', ({ input, expected }) => {
    expect(resolveAssuranceMerchantSetting(input)).toBe(expected);
  });
});

describe('resolveAssuranceLabel', () => {
  it.each([
    { merchantSlug: 'ogabassey', expected: 'Ogabassey Assurance' },
    { merchantSlug: 'OGABASSEY', expected: 'Ogabassey Assurance' },
    { merchantSlug: 'another-store', expected: 'Order Protection' },
    { merchantSlug: null, expected: 'Order Protection' },
    { merchantSlug: undefined, expected: 'Order Protection' },
  ])('labels $merchantSlug as $expected', ({ merchantSlug, expected }) => {
    expect(resolveAssuranceLabel(merchantSlug)).toBe(expected);
  });
});

describe('shouldDeferAssuranceDefault', () => {
  const eligible = {
    smartCartProEnabled: true,
    merchantSlug: 'ogabassey',
    shippingInsuranceEnabled: undefined,
  };
  it('defers an eligible line only while the setting is unknown', () => {
    expect(shouldDeferAssuranceDefault(undefined, eligible)).toBe(true);
    expect(
      shouldDeferAssuranceDefault(undefined, {
        ...eligible,
        shippingInsuranceEnabled: true,
      })
    ).toBe(false);
    expect(
      shouldDeferAssuranceDefault(undefined, {
        ...eligible,
        shippingInsuranceEnabled: false,
      })
    ).toBe(false);
  });
  it('never defers explicit choices, vouchers, or ineligible merchants', () => {
    expect(shouldDeferAssuranceDefault(false, eligible)).toBe(false);
    expect(shouldDeferAssuranceDefault(true, eligible)).toBe(false);
    expect(
      shouldDeferAssuranceDefault(undefined, {
        ...eligible,
        hasQuizVoucher: true,
      })
    ).toBe(false);
    expect(
      shouldDeferAssuranceDefault(undefined, {
        ...eligible,
        smartCartProEnabled: false,
      })
    ).toBe(false);
    expect(
      shouldDeferAssuranceDefault(undefined, {
        ...eligible,
        merchantSlug: 'another-store',
      })
    ).toBe(false);
  });
  it('matches slugs case-insensitively like the default', () => {
    expect(
      shouldDeferAssuranceDefault(undefined, {
        ...eligible,
        merchantSlug: 'OGABASSEY',
      })
    ).toBe(true);
  });
});
