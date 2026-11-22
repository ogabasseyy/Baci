import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, vi } from 'vitest';
import { createStorefrontOrderRpcClient } from '@/lib/checkout/storefront-order-rpc-client';
import { verifyBankCardOfferPaystack } from '@/lib/checkout/verify-bank-card-offer-paystack';
import { bankCardOfferContextFixture } from '@/schemas/bank-card-offer-payment-context.test-support';
import type { GuestPaymentReferenceSnapshot } from './guest-payment-reference-snapshot';
import { verifySessionlessBankCardOffer } from './verify-sessionless-bank-card-offer';

vi.mock('@/lib/checkout/storefront-order-rpc-client', () => ({
  createStorefrontOrderRpcClient: vi.fn(),
}));
vi.mock('@/lib/checkout/verify-bank-card-offer-paystack', () => ({
  verifyBankCardOfferPaystack: vi.fn(),
}));

export const verify = vi.mocked(verifyBankCardOfferPaystack);
export const verifyNative = (
  snapshot: GuestPaymentReferenceSnapshot,
  client: SupabaseClient
) =>
  verifySessionlessBankCardOffer(
    snapshot,
    client,
    createStorefrontOrderRpcClient
  );
export const rpc = vi.fn();
export const buyerRpc = vi.fn();
export const buyerClient = { rpc: buyerRpc } as unknown as SupabaseClient;
export const reference = `BCO-${'a'.repeat(32)}`;
export const saved = {
  ...bankCardOfferContextFixture,
  reference,
  domain: 'test',
  acceptedFilterPolicyHash: 'a'.repeat(64),
};
export const snapshot: GuestPaymentReferenceSnapshot = {
  orderId: 'order-1',
  transactionId: 'transaction-1',
  merchantId: saved.quote.merchantId,
  orderNumber: 'ORD-1',
  amount: 95,
  currency: 'NGN',
  transactionStatus: 'pending',
  gateway: 'paystack',
  gatewayReference: reference,
  orderPaymentStatus: 'pending',
  orderShippingStatus: 'pending',
  orderTotal: 95,
  inventoryConfirmed: false,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(createStorefrontOrderRpcClient).mockReturnValue({
    rpc,
  } as unknown as SupabaseClient);
  rpc.mockResolvedValueOnce({ data: saved, error: null });
  buyerRpc.mockResolvedValue({ data: true, error: null });
});
