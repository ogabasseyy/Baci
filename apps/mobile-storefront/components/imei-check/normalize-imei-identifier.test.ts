import { normalizeDeviceIdentifier } from '@baci/shared/imei';
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

  // Muse: the server must see the same identifier the app keyed and paid
  // for. The IMEI route and the pay path both normalise with the shared
  // normalizeDeviceIdentifier, which upper-cases serials the same way.
  it('matches the server form for a typed serial, IMEI or either', () => {
    expect(normalizeImeiIdentifier('c02xl0abjgh5')).toBe(
      normalizeDeviceIdentifier('c02xl0abjgh5', 'serial')
    );
    expect(normalizeImeiIdentifier('f2l-xk1 abc')).toBe(
      normalizeDeviceIdentifier('f2l-xk1 abc', 'both')
    );
    expect(normalizeImeiIdentifier('356938 035643809')).toBe(
      normalizeDeviceIdentifier('356938 035643809', 'imei')
    );
  });
});
