import { IMEI_SERVICE_TIERS } from '@baci/shared/imei';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executeImeiLookup } from './execute-imei-lookup';

type FulfillmentModule = typeof import('@/lib/imei-lookup-fulfillment');

const mocks = vi.hoisted(() => ({
  balance: vi.fn(),
  debit: vi.fn(),
  petrock: vi.fn(),
  recover: vi.fn(),
}));
vi.mock('@/lib/imei-lookup-fulfillment', async (importOriginal) => ({
  ...(await importOriginal<FulfillmentModule>()),
  readCustomerWalletBalance: mocks.balance,
  redeemImeiWalletPayment: mocks.debit,
}));
vi.mock('./petrock-submission-flow', () => ({
  submitPetrockLookup: mocks.petrock,
}));
vi.mock('./recover-imei-lookup-failure', () => ({
  recoverImeiLookupFailure: mocks.recover,
}));
function input() {
  return {
    customer: { id: 'customer' },
    deviceCategory: 'smartphone',
    encryptionKey: 'key',
    binding: {
      provider: 'petrock',
      costUsd: 0.06,
      productId: '716',
      orderFieldName: 'IMEI',
      deviceCategories: ['smartphone'],
    },
    provider: { submit: vi.fn() },
    serviceTier: IMEI_SERVICE_TIERS.simLock,
    supabase: {},
    supabaseAdmin: {
      insertPending: vi
        .fn()
        .mockResolvedValue({ data: { id: 'lookup' }, error: null }),
      readReplay: vi.fn(),
    },
    idempotencyKey: 'idempotency',
    imeiHash: 'hash',
    merchantId: 'merchant',
    normalizedImei: '354442067957452',
    replayContext: {
      customerId: 'customer',
      merchantId: 'merchant',
      imeiHash: 'hash',
      tier: 'simLock',
      deviceCategory: 'smartphone',
    },
    request: { nextUrl: { origin: 'https://store.example.com' } },
    requestedTier: 'simLock',
  };
}
function run(args: ReturnType<typeof input>) {
  return executeImeiLookup(
    args as unknown as Parameters<typeof executeImeiLookup>[0]
  );
}

describe('IMEI lookup execution invariants', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.balance.mockResolvedValue(5000);
    mocks.recover.mockResolvedValue(Response.json({}, { status: 500 }));
  });
  it('replays a concurrent winning lookup without charging or submitting again', async () => {
    const args = input();
    args.supabaseAdmin.insertPending.mockResolvedValue({
      data: null,
      error: { code: '23505', message: 'duplicate' },
    });
    args.supabaseAdmin.readReplay.mockResolvedValue({
      data: {
        id: 'winner',
        customer_id: 'customer',
        merchant_id: 'merchant',
        imei_hash: 'hash',
        tier: 'simLock',
        device_category: 'smartphone',
        status: 'pending_provider',
      },
      error: null,
    });
    const response = await run(args);
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      lookupId: 'winner',
      status: 'pending',
    });
    expect(mocks.debit).not.toHaveBeenCalled();
    expect(mocks.petrock).not.toHaveBeenCalled();
    expect(mocks.balance).not.toHaveBeenCalled();
  });
  it('rejects another customer owning a concurrent idempotency winner without exposing their result', async () => {
    const args = input();
    args.supabaseAdmin.insertPending.mockResolvedValue({
      data: null,
      error: { code: '23505', message: 'duplicate' },
    });
    args.supabaseAdmin.readReplay.mockResolvedValue({
      data: null,
      error: null,
    });
    const response = await run(args);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
    });
    expect(mocks.petrock).not.toHaveBeenCalled();
  });
  it('does not retry an ambiguous paid Petrock submission and preserves the debit flag for recovery', async () => {
    const args = input();
    mocks.petrock.mockImplementation(
      async ({ onDebitSucceeded }: { onDebitSucceeded: () => void }) => {
        onDebitSucceeded();
        throw new Error('unknown provider result');
      }
    );
    await run(args);
    expect(mocks.petrock).toHaveBeenCalledTimes(1);
    expect(mocks.recover).toHaveBeenCalledWith(
      expect.objectContaining({
        debitSucceeded: true,
        activeLookup: expect.objectContaining({
          id: 'lookup',
          provider: 'petrock',
        }),
      })
    );
    expect(mocks.debit).not.toHaveBeenCalled();
  });
  it('does not call a provider when persistence fails before a lookup exists', async () => {
    const args = input();
    args.supabaseAdmin.insertPending.mockResolvedValue({
      data: null,
      error: { message: 'access denied' },
    });
    await run(args);
    expect(mocks.petrock).not.toHaveBeenCalled();
    expect(mocks.debit).not.toHaveBeenCalled();
    expect(mocks.recover).toHaveBeenCalledWith(
      expect.objectContaining({ activeLookup: null, debitSucceeded: false })
    );
  });
});
