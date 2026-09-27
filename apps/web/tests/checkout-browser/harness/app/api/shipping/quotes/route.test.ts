import { describe, expect, it } from 'vitest';
import { POST } from './route';

const validQuoteRequest = {
  deliveryPreference: 'door',
  receiver: {
    name: 'Test Reviewer',
    address: '12 Broad Street',
    city: 'Lagos Island',
    state: 'Lagos',
    latitude: 6.45,
    longitude: 3.39,
  },
  items: [
    { name: 'Checkout test phone', quantity: 1, weight: 1, value: 100000 },
  ],
};

describe('fixture shipping quote route', () => {
  it('rejects invalid quote requests', async () => {
    const response = await POST(
      new Request('http://localhost/api/shipping/quotes', {
        method: 'POST',
        body: '{',
      })
    );
    expect(response.status).toBe(400);
  });

  it.each([
    ['door', false],
    ['pickup_station', true],
  ] as const)('returns a normalized local %s quote without contacting a carrier', async (deliveryPreference, isStationPickup) => {
    const response = await POST(
      new Request('http://localhost/api/shipping/quotes', {
        method: 'POST',
        body: JSON.stringify({ ...validQuoteRequest, deliveryPreference }),
      })
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      quotes: {
        featured: [
          {
            provider: 'GIGL',
            serviceTier: 'Standard',
            price: 0,
            currency: 'NGN',
            isStationPickup,
          },
        ],
      },
      sessionId: 'fixture-shipping-session',
    });
  });
});
