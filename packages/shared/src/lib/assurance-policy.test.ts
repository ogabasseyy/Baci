import { describe, expect, it } from 'vitest';
import { resolveAddedLineAssurance } from './assurance-policy';

describe('resolveAddedLineAssurance', () => {
  const policy = { smartCartProEnabled: true, merchantSlug: 'ogabassey' };
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
  it.each([
    true,
    undefined,
  ])('keeps the default when insurance is enabled or unknown: %s', (shippingInsuranceEnabled) => {
    expect(
      resolveAddedLineAssurance(undefined, undefined, {
        ...policy,
        shippingInsuranceEnabled,
      })
    ).toBe(true);
  });
});
