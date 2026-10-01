import { describe, expect, it } from 'vitest';
import { resolveBookingQuoteRequestPayload } from './quote-request-payload';

describe('bugfix: Topship international booking sender', () => {
  it('keeps the stored sender instead of falling back to the current origin', () => {
    const payload = resolveBookingQuoteRequestPayload(
      {
        provider: 'TOPSHIP',
        provider_rate_id: 'Premium_Express',
        quote_request: {
          sessionId: 'session-1',
          shipmentType: 'international',
          sender: {
            name: 'Quoted Store',
            phone: '+2348011111111',
            address: '1 Quoted Road',
            city: 'Ikeja',
            state: 'Lagos',
            country: 'Nigeria',
            countryCode: 'NG',
          },
          receiver: {
            name: 'Customer',
            phone: '+14165550123',
            address: '2 Customer Road',
            city: 'Toronto',
            state: 'Ontario',
            country: 'Canada',
            countryCode: 'CA',
          },
          items: [
            {
              name: 'Phone',
              quantity: 1,
              weight: 1,
              value: 100_000,
              hsCode: '851712',
            },
          ],
        },
      },
      {
        name: 'Customer',
        phone: '+14165550123',
        address: '2 Customer Road',
        city: 'Toronto',
        state: 'Ontario',
        country: 'Canada',
        countryCode: 'CA',
      },
      [{ name: 'Phone', quantity: 1, weight: 1, value: 100_000 }]
    );

    expect(payload).toEqual(
      expect.objectContaining({
        sender: expect.objectContaining({
          address: '1 Quoted Road',
          city: 'Ikeja',
          countryCode: 'NG',
        }),
      })
    );
  });
});
