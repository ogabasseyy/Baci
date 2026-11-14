import { normalizeImeiIdentifier } from './normalize-imei-identifier';

describe('normalizeImeiIdentifier', () => {
  it('drops spaces and dashes and upper-cases serials', () => {
    expect(normalizeImeiIdentifier(' 3569 3803-5643809 ')).toBe(
      '356938035643809'
    );
    expect(normalizeImeiIdentifier('c02x-l0ab jgh5')).toBe('C02XL0ABJGH5');
  });

  it('leaves an empty input empty', () => {
    expect(normalizeImeiIdentifier(' - ')).toBe('');
  });
});
