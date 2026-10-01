import { describe, expect, it } from 'vitest';
import { isBaciPaystackSettlementCountry } from './is-baci-paystack-settlement-country';

describe('isBaciPaystackSettlementCountry', () => {
  it.each([
    undefined,
    null,
    '',
    '  ',
    'NG',
    ' ng ',
  ])('supports legacy and Nigerian country values: %s', (country) => {
    expect(isBaciPaystackSettlementCountry(country)).toBe(true);
  });

  it.each(['GH', 'KE', 'IN'])('rejects non-Nigerian country %s', (country) => {
    expect(isBaciPaystackSettlementCountry(country)).toBe(false);
  });
});
