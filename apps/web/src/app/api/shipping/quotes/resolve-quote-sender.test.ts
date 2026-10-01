import { describe, expect, it } from 'vitest';
import { resolveQuoteSender } from './resolve-quote-sender';

const sender = {
  name: 'Abuja Store',
  phone: '+2348012345678',
  address: '29 Yedseram Crescent',
  city: 'Maitama',
  state: 'Abuja',
  country: 'Nigeria',
  countryCode: 'NG',
};

describe('resolveQuoteSender', () => {
  it('preserves a trusted merchant sender', () => {
    expect(
      resolveQuoteSender({
        merchantId: 'merchant-1',
        sender,
        shipmentType: 'domestic',
      })
    ).toEqual({ ok: true, sender });
  });

  it('fails closed when a resolved merchant has no origin', () => {
    expect(
      resolveQuoteSender({
        merchantId: 'merchant-1',
        shipmentType: 'domestic',
      })
    ).toEqual({
      error: 'Merchant shipping origin is not configured',
      ok: false,
      status: 400,
    });
  });

  it('requires an origin for anonymous international quotes', () => {
    expect(resolveQuoteSender({ shipmentType: 'international' })).toEqual({
      error: 'Sender is required for international quotes',
      ok: false,
      status: 400,
    });
  });

  it('retains the legacy Lagos fallback for anonymous domestic quotes', () => {
    expect(resolveQuoteSender({ shipmentType: 'domestic' })).toEqual({
      ok: true,
      sender: expect.objectContaining({
        address: 'Lagos',
        city: 'Lagos',
        countryCode: 'NG',
        state: 'Lagos',
      }),
    });
  });
});
