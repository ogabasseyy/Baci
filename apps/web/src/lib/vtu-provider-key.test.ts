import { describe, expect, it } from 'vitest';
import { resolveVtuProviderKey } from './vtu-provider-key';

const allFields = {
  billerCode: 'code',
  billerName: 'name',
  billItemIdentifier: 'item',
  isTelco: false,
  productCode: 'product',
};

describe('resolveVtuProviderKey', () => {
  it('returns the normalized network for airtime and data, whatever the bill fields hold', () => {
    expect(
      resolveVtuProviderKey({
        ...allFields,
        isTelco: true,
        normalizedNetworkProvider: 'MTN',
        order: 'kuda',
      })
    ).toBe('MTN');
  });

  it.each([
    ['routing', 'name'],
    ['monnify', 'code'],
    ['kuda', 'item'],
  ] as const)('prefers the %s field order for a bill payment', (order, expected) => {
    expect(resolveVtuProviderKey({ ...allFields, order })).toBe(expected);
  });

  it.each([
    ['routing', { billerName: '   ' }, 'code'],
    ['monnify', { billerCode: undefined }, 'product'],
    ['kuda', { billItemIdentifier: '', productCode: ' ' }, 'name'],
  ] as const)('skips blank fields and trims the one it takes (%s)', (order, blank, expected) => {
    expect(
      resolveVtuProviderKey({
        ...allFields,
        billerCode: ' code ',
        ...blank,
        order,
      })
    ).toBe(expected);
  });

  it('throws when a bill payment carries no provider field at all', () => {
    expect(() =>
      resolveVtuProviderKey({
        billerCode: ' ',
        isTelco: false,
        order: 'routing',
      })
    ).toThrow('Biller name or provider key is required for bill payment');
  });
});
