import { createHmac } from 'node:crypto';
import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/env', () => ({ getSupabaseServiceRoleKey: () => 's'.repeat(32) }));

import { prepareCheckoutShippingRecovery } from './prepare-checkout-shipping-recovery';

const input = {
  orderId: 'order-1',
  merchantId: 'merchant-1',
  fingerprint: 'f'.repeat(64),
  paidShippingFee: 110,
  quote: {
    id: 'quote-1',
    provider: 'GIGL',
    serviceTier: 'standard',
    carrierName: 'GIG Logistics',
    displayName: 'GIG',
    estimatedDays: 2,
    price: 110,
    currency: 'NGN',
    pickupIncluded: true,
    insuranceIncluded: true,
    expiresAt: new Date(Date.now() + 3600000),
  },
  quoteRequest: {
    sessionId: 'order-1',
    shipmentType: 'domestic',
    receiver: {
      name: 'Test',
      phone: '08000000000',
      address: '1 Test Street',
      city: 'Ikeja',
      state: 'Lagos',
      country: 'Nigeria',
      countryCode: 'NG',
      latitude: 6.6,
      longitude: 3.35,
    },
    items: [],
  },
};
it('signs only the fixed recovery action and sends it through the caller client', async () => {
  const client = {
    rpc: vi.fn().mockResolvedValue({ data: 'preview-1', error: null }),
  };
  await expect(
    prepareCheckoutShippingRecovery(client as never, input as never)
  ).resolves.toEqual({ data: 'preview-1', error: null });
  const [name, params] = client.rpc.mock.calls[0];
  expect(name).toBe('prepare_customer_checkout_shipping_recovery');
  expect(params.p_quote.quote_request.merchantId).toBe(input.merchantId);
  const proof = params.p_route_proof;
  expect(proof.action).toBe(name);
  expect(proof.subject_id).toBe(input.orderId);
  expect(proof.merchant_id).toBe(input.merchantId);
  expect(JSON.parse(proof.payload_text)).toEqual({
    order_id: input.orderId,
    fingerprint: input.fingerprint,
    quote: params.p_quote,
  });
  expect(proof.signature).toBe(
    createHmac('sha256', 's'.repeat(32))
      .update(
        [
          'baci:shipping-quote-rpc:v1',
          proof.version,
          name,
          input.orderId,
          input.merchantId,
          proof.issued_at,
          proof.payload_text,
        ].join('\n')
      )
      .digest('hex')
  );
});
it.each([
  { orderId: '' },
  { merchantId: '' },
  { fingerprint: '' },
  { quoteRequest: { ...input.quoteRequest, merchantId: 'foreign-merchant' } },
  { paidShippingFee: 111 },
  { quote: { ...input.quote, provider: 'TOPSHIP' } },
  { quote: { ...input.quote, currency: 'USD' } },
  { quote: { ...input.quote, isStationPickup: true } },
  { quoteRequest: { ...input.quoteRequest, shipmentType: 'international' } },
  {
    quoteRequest: {
      ...input.quoteRequest,
      receiver: { ...input.quoteRequest.receiver, latitude: undefined },
    },
  },
])('rejects an unscoped or ineligible signing request before RPC: %j', async (change) => {
  const client = { rpc: vi.fn() };
  await expect(
    prepareCheckoutShippingRecovery(
      client as never,
      { ...input, ...change } as never
    )
  ).rejects.toThrow('invalid_checkout_shipping_recovery_proof_context');
  expect(client.rpc).not.toHaveBeenCalled();
});
