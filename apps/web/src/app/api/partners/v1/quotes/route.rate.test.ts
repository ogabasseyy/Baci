import { expect, it } from 'vitest';
import { mocks, POST, quoteId, request } from './route.test-support';

it('breaks equal-price ties by service name codepoint order', async () => {
  const rate = {
    id: quoteId,
    provider: 'GIGL',
    currency: 'NGN',
    providerRateId: 'fixture-rate',
    providerCost: 1000,
    price: 1500,
    estimatedDays: 2,
    expiresAt: new Date('2026-11-20T14:04:00Z'),
  };
  mocks.rates.mockResolvedValueOnce([
    { ...rate, serviceTier: 'express' },
    { ...rate, serviceTier: 'Standard' },
  ]);
  const response = await POST(request());
  expect(response.status).toBe(201);
  expect(await response.json()).toMatchObject({ service: 'Standard' });
});
