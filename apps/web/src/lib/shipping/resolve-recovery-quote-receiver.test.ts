import { describe, expect, it } from 'vitest';
import { resolveRecoveryQuoteReceiver } from './resolve-recovery-quote-receiver';

const receiver = {
  address: '12 Test Street',
  city: 'Ikeja',
  state: 'Lagos',
  latitude: 6.6018,
  longitude: 3.3515,
};

describe('resolveRecoveryQuoteReceiver', () => {
  it('rejects explicit non-Nigerian country codes', () => {
    expect(
      resolveRecoveryQuoteReceiver({ ...receiver, countryCode: 'GH' }, {})
    ).toEqual({ error: 'This recovery supports Nigerian destinations only.' });
  });
  it('rejects manual pins outside Nigeria without a country code', () => {
    const resolved = resolveRecoveryQuoteReceiver(
      { ...receiver, latitude: 40.7128, longitude: -74.006 },
      {}
    );
    expect(resolved).toEqual({
      error:
        'Manual pins must fall within Nigeria. Search for the address to attach its country.',
    });
  });
  it('accepts in-bounds manual pins and carries the legacy postal code', () => {
    const resolved = resolveRecoveryQuoteReceiver(receiver, {
      postal_code: '100001',
    });
    expect(resolved).toEqual({
      override: expect.objectContaining({
        address: expect.stringContaining('12 Test Street'),
        postalCode: '100001',
      }),
    });
  });
  it('prefers an explicit camelCase postal code', () => {
    const resolved = resolveRecoveryQuoteReceiver(
      { ...receiver, countryCode: 'NG' },
      { postalCode: '101002' }
    );
    expect(resolved).toEqual({
      override: expect.objectContaining({ postalCode: '101002' }),
    });
  });
});
