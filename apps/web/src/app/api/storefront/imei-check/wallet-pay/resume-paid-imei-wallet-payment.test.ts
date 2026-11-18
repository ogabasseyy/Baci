import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resumePaidImeiWalletPayment } from './resume-paid-imei-wallet-payment';

vi.mock('server-only', () => ({}));

const LOOKUP = '11111111-1111-4111-8111-111111111111';
const OP = '5b0f2a40-1c1d-4e6b-9a51-2f3c4d5e6f70';
const existing = {
  id: LOOKUP,
  amount_ngn: 500,
  customer_id: 'c',
  merchant_id: 'm',
  imei_hash: 'h',
  status: 'pending',
  tier: 'simLock',
  device_category: 'smartphone',
  cached_response: null,
  cached_status: null,
} as never;
const input = {
  existing,
  customerId: 'c',
  merchantId: 'm',
  imeiHash: 'h',
  tier: 'simLock' as const,
  deviceCategory: 'smartphone' as const,
  supabase: {} as never,
  user: { id: 'u' } as never,
};
const deps = (state: string | null) => ({
  readRuntime: vi.fn(
    () =>
      ({
        merchantId: 'm',
        businessId: 'b',
        configuration: { integrationId: 'i', environment: 'staging' },
      }) as never
  ),
  resolveIdentity: vi.fn(async () => ({
    merchantId: 'm',
    customerId: 'c',
    userId: 'u',
  })),
  findForPurchase: vi.fn(async () =>
    state ? ({ state, operationId: OP } as never) : null
  ),
});

beforeEach(() => vi.clearAllMocks());

describe('bugfix: a paid PiggyVest replay could not resume while the provider preflight failed (Codex P2)', () => {
  it('hands back an operation that moved money, so the check is delivered', async () => {
    for (const state of ['dispatched', 'confirmed']) {
      const response = await resumePaidImeiWalletPayment(input, deps(state));
      expect(response?.status).toBe(202);
      await expect(response?.json()).resolves.toEqual({
        status: 'payment_pending',
        lookupId: LOOKUP,
        operationId: OP,
        amountKobo: 50000,
      });
    }
    const review = await resumePaidImeiWalletPayment(
      input,
      deps('needs_review')
    );
    await expect(review?.json()).resolves.toMatchObject({
      status: 'payment_review',
    });
  });

  it('leaves the preflight answer for a payment that moved nothing, or none', async () => {
    for (const state of ['issued', 'released', null])
      await expect(
        resumePaidImeiWalletPayment(input, deps(state))
      ).resolves.toBeNull();
  });

  it('never resumes another request (customer, IMEI, tier or device)', async () => {
    const d = deps('confirmed');
    for (const change of [
      { customerId: 'other' },
      { imeiHash: 'other' },
      { tier: 'basic' as const },
      { deviceCategory: 'tablet' as const },
    ])
      await expect(
        resumePaidImeiWalletPayment({ ...input, ...change }, d)
      ).resolves.toBeNull();
    expect(d.findForPurchase).not.toHaveBeenCalled();
  });

  it('answers null when PiggyVest is not configured for this store', async () => {
    const d = {
      ...deps('confirmed'),
      readRuntime: vi.fn(() => {
        throw new Error('missing');
      }),
    };
    await expect(resumePaidImeiWalletPayment(input, d)).resolves.toBeNull();
  });
});
