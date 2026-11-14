import { beforeEach, describe, expect, it, vi } from 'vitest';
import { recoverWalletPaidVtuPurchases } from './recover-wallet-paid-vtu-purchases';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/piggyvest/wallet-pay-ports', () => ({
  createWalletPayPorts: vi.fn(),
}));
vi.mock('@/lib/piggyvest/wallet-pay-service', () => ({
  refundWalletPayment: vi.fn(),
  walletPayDelivery: vi.fn(),
}));
vi.mock('@/lib/vtu-fulfillment', () => ({
  fulfillPendingVtuTransaction: vi.fn(),
}));

const OP = '11111111-1111-4111-8111-111111111111';
const TXN = '33333333-3333-4333-8333-333333333333';
const TOKEN = '22222222-2222-4222-8222-222222222222';
const claimed = (status: 'claimed' | 'reclaimed' = 'reclaimed') => ({
  status,
  purpose: 'vtu',
  purchaseRef: TXN,
  amountKobo: 100000,
  claimToken: TOKEN,
});

const worker = { listWork: vi.fn(), claim: vi.fn() };
const delivery = {
  vtuDeliveryState: vi.fn(),
  finish: vi.fn(),
  claim: vi.fn(),
};
const refund = vi.fn();
const fulfil = vi.fn();
const maybeSingle = vi.fn();
const supabase = {
  from: () => ({
    select: () => ({ eq: () => ({ maybeSingle }) }),
  }),
} as never;
const deps = {
  readRuntime: vi.fn(() => ({ merchantId: 'm' }) as never),
  worker: () => worker as never,
  delivery: () => delivery as never,
  refund,
  fulfil,
} as never;

beforeEach(() => {
  vi.clearAllMocks();
  worker.listWork.mockResolvedValue({
    deliver: [{ operationId: OP, purpose: 'vtu' }],
    refund: [],
    settle: [],
  });
  delivery.vtuDeliveryState.mockResolvedValue('processing');
  worker.claim.mockResolvedValue(claimed());
  delivery.finish.mockResolvedValue('fulfilled');
  maybeSingle.mockResolvedValue({
    data: { amount: 1000, metadata: { paymentSource: 'piggyvest_wallet' } },
    error: null,
  });
  fulfil.mockResolvedValue({
    status: 'successful',
    amount: 1000,
    reference: 'VTU-1',
  });
});

describe('bugfix: an interrupted PiggyVest-paid vend waited for the customer to return (Codex P1)', () => {
  it('re-drives a purchase left mid-vend under the payment claim and records it', async () => {
    const summary = await recoverWalletPaidVtuPurchases(
      { supabase },
      deps as never
    );
    expect(fulfil).toHaveBeenCalledWith({
      supabase,
      transactionId: TXN,
      walletPayClaimed: true,
    });
    expect(delivery.finish).toHaveBeenCalledWith(OP, 'fulfilled', TOKEN);
    expect(summary).toEqual({
      checked: 1,
      recovered: 1,
      errored: 0,
      deferred: 0,
    });
  });

  it('owes the one refund when the re-driven vend failed', async () => {
    fulfil.mockResolvedValue({
      status: 'failed',
      amount: 1000,
      reference: 'VTU-1',
      error: 'x',
    });
    delivery.finish.mockResolvedValue('refund_owed');
    await recoverWalletPaidVtuPurchases({ supabase }, deps as never);
    expect(delivery.finish).toHaveBeenCalledWith(OP, 'failed', TOKEN);
    expect(refund).toHaveBeenCalledTimes(1);
  });

  it('leaves a purchase that is not mid-vend to the drain, taking no claim', async () => {
    delivery.vtuDeliveryState.mockResolvedValue('failed');
    await recoverWalletPaidVtuPurchases({ supabase }, deps as never);
    expect(worker.claim).not.toHaveBeenCalled();
    expect(fulfil).not.toHaveBeenCalled();
  });

  it('vends nothing when another holder has the claim', async () => {
    worker.claim.mockResolvedValue({ status: 'busy' });
    await recoverWalletPaidVtuPurchases({ supabase }, deps as never);
    expect(fulfil).not.toHaveBeenCalled();
  });

  it('vends nothing for a purchase that is not PiggyVest-paid or at another amount', async () => {
    maybeSingle.mockResolvedValueOnce({
      data: { amount: 1000, metadata: {} },
      error: null,
    });
    await recoverWalletPaidVtuPurchases({ supabase }, deps as never);
    maybeSingle.mockResolvedValueOnce({
      data: { amount: 999, metadata: { paymentSource: 'piggyvest_wallet' } },
      error: null,
    });
    await recoverWalletPaidVtuPurchases({ supabase }, deps as never);
    expect(fulfil).not.toHaveBeenCalled();
  });

  it('skips other products and does nothing where wallet pay is not configured', async () => {
    worker.listWork.mockResolvedValue({
      deliver: [{ operationId: OP, purpose: 'imei_check' }],
      refund: [],
      settle: [],
    });
    await recoverWalletPaidVtuPurchases({ supabase }, deps as never);
    expect(delivery.vtuDeliveryState).not.toHaveBeenCalled();
    const off = {
      ...(deps as object),
      readRuntime: () => {
        throw new Error('not configured');
      },
    };
    await expect(
      recoverWalletPaidVtuPurchases({ supabase }, off as never)
    ).resolves.toEqual({ checked: 0, recovered: 0, errored: 0, deferred: 0 });
  });

  it('counts a failure and carries on, never throwing', async () => {
    worker.claim.mockRejectedValueOnce(new Error('db down'));
    await expect(
      recoverWalletPaidVtuPurchases({ supabase }, deps as never)
    ).resolves.toMatchObject({ checked: 1, errored: 1 });
  });
});

describe('bugfix: recovery could run past the cron deadline holding a claim (Codex P2)', () => {
  it('takes no claim when too little time remains before the deadline', async () => {
    const summary = await recoverWalletPaidVtuPurchases(
      { supabase, deadlineMs: Date.now() + 1000 },
      deps
    );
    expect(worker.claim).not.toHaveBeenCalled();
    expect(fulfil).not.toHaveBeenCalled();
    expect(summary).toEqual({
      checked: 0,
      recovered: 0,
      errored: 0,
      deferred: 1,
    });
  });

  it('still recovers when the deadline is far away', async () => {
    const summary = await recoverWalletPaidVtuPurchases(
      { supabase, deadlineMs: Date.now() + 600_000 },
      deps
    );
    expect(summary.recovered).toBe(1);
    expect(summary.deferred).toBe(0);
  });
});
