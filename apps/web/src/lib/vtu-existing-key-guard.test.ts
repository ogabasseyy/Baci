import { beforeEach, describe, expect, it, vi } from 'vitest';
import { refuseForeignOrChangedReplay } from './vtu-existing-key-guard';

const ownership = vi.hoisted(() => vi.fn());
vi.mock('@/lib/vtu-checkout-ownership', () => ({
  resolveRequestingOwnership: ownership,
}));

const existing = {
  key: 'k',
  vtu_transaction_id: 'txn',
  customer_id: 'customer-1',
  merchant_id: 'merchant-1',
  request_fingerprint: 'fp',
};
const guard = (requestFingerprint = 'fp') =>
  refuseForeignOrChangedReplay({
    supabase: {} as never,
    user: { id: 'u' } as never,
    merchantSlug: 'shop',
    existing,
    requestFingerprint,
  });

beforeEach(() => {
  ownership.mockResolvedValue({
    customerId: 'customer-1',
    merchantId: 'merchant-1',
  });
});

describe('refuseForeignOrChangedReplay', () => {
  it('lets the owner replay the same request', async () => {
    await expect(guard()).resolves.toBeNull();
  });

  it('refuses another customer or storefront (400, no row fields)', async () => {
    ownership.mockResolvedValue({
      customerId: 'other',
      merchantId: 'merchant-1',
    });
    const customer = await guard();
    expect(customer?.status).toBe(400);
    await expect(customer?.json()).resolves.toEqual({
      error: 'Idempotency-Key does not belong to this customer.',
    });
    ownership.mockResolvedValue({ customerId: 'customer-1', merchantId: null });
    expect((await guard())?.status).toBe(400);
  });

  it('refuses a changed payload with 409', async () => {
    expect((await guard('changed'))?.status).toBe(409);
  });
});
