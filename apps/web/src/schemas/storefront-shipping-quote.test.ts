import { expect, it } from 'vitest';
import {
  shippingQuoteReadProofSchema,
  storefrontShippingQuoteReadSchema,
} from './storefront-shipping-quote';

it('bounds normal quote lookup and rejects write proofs or private authority disguised as read continuations', () => {
  expect(
    storefrontShippingQuoteReadSchema.safeParse({ sessionId: 's'.repeat(201) })
      .success
  ).toBe(false);
  expect(
    shippingQuoteReadProofSchema.safeParse({
      action: 'persist_storefront_shipping_quote',
      signature: 'a'.repeat(64),
    }).success
  ).toBe(false);
});

it('accepts a complete read proof but rejects changing only its action to a write proof', () => {
  const read = {
    version: 'baci-shipping-quote-proof:v1',
    action: 'read_storefront_shipping_quotes',
    issued_at: '2026-10-25T00:00:00.000Z',
    merchant_id: '10000000-0000-4000-8000-000000000001',
    subject_id: '20000000-0000-4000-8000-000000000001',
    payload_text: '{}',
    proof_id: 'a'.repeat(24),
    signature: 'a'.repeat(64),
  };
  expect(shippingQuoteReadProofSchema.safeParse(read).success).toBe(true);
  expect(
    shippingQuoteReadProofSchema.safeParse({
      ...read,
      action: 'persist_storefront_shipping_quote',
    }).success
  ).toBe(false);
});
