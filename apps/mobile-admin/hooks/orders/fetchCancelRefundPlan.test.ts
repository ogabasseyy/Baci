import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ evidence: vi.fn(), result: vi.fn() }));

vi.mock('@baci/shared', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const real = actual.getCancelRefundPlan as (...args: unknown[]) => unknown;
  return { ...actual, getCancelRefundPlan: vi.fn(real) };
});

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: mocks.evidence,
    from: () => ({
      select: () => ({
        eq: () => ({ eq: () => ({ in: mocks.result }) }),
      }),
    }),
  },
}));

import { getCancelRefundPlan } from '@baci/shared';
import { fetchCancelRefundPlan } from './fetchCancelRefundPlan';

const args = {
  amountPaid: 5000,
  merchantId: 'm1',
  orderId: 'o1',
  paymentStatus: 'paid',
  total: 5000,
};

describe('fetchCancelRefundPlan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.evidence.mockResolvedValue({ data: false, error: null });
  });

  it('plans the outstanding Paystack leg as automatically refundable', async () => {
    mocks.result.mockResolvedValue({
      data: [
        {
          amount: 5000,
          currency: 'NGN',
          gateway: 'paystack',
          gateway_reference: 'ref',
          id: 'leg-1',
          status: 'completed',
          transaction_type: 'payment',
        },
      ],
      error: null,
    });
    await expect(fetchCancelRefundPlan(args)).resolves.toEqual({
      amount: 5000,
      automaticSupported: true,
      inFlightAmount: 0,
      ledgerKnown: true,
    });
  });

  it('marks a Korapay leg as not automatically refundable', async () => {
    mocks.result.mockResolvedValue({
      data: [
        {
          amount: 5000,
          currency: 'NGN',
          gateway: 'korapay',
          gateway_reference: 'ref',
          id: 'leg-1',
          status: 'completed',
          transaction_type: 'payment',
        },
      ],
      error: null,
    });
    await expect(fetchCancelRefundPlan(args)).resolves.toMatchObject({
      automaticSupported: false,
    });
  });

  it('returns undefined when the ledger cannot be read', async () => {
    mocks.result.mockResolvedValue({ data: null, error: { message: 'x' } });
    await expect(fetchCancelRefundPlan(args)).resolves.toBeUndefined();
  });

  it('normalizes a differently cased paid status before planning', async () => {
    mocks.result.mockResolvedValue({ data: [], error: null });
    await fetchCancelRefundPlan({ ...args, paymentStatus: 'PAID' });
    expect(getCancelRefundPlan).toHaveBeenCalledWith(
      expect.objectContaining({ paymentStatus: 'Paid' })
    );
  });

  it('marks the plan unresolved while a movement review is open', async () => {
    mocks.result.mockResolvedValue({
      data: [
        {
          amount: 5000,
          currency: 'NGN',
          gateway: 'paystack',
          gateway_reference: 'ref',
          id: 'leg-1',
          status: 'completed',
          transaction_type: 'payment',
        },
      ],
      error: null,
    });
    mocks.evidence.mockResolvedValue({ data: true, error: null });
    await expect(fetchCancelRefundPlan(args)).resolves.toMatchObject({
      ledgerKnown: false,
    });
    expect(mocks.evidence).toHaveBeenCalledWith(
      'order_has_unresolved_refund_evidence',
      { p_order_id: 'o1' }
    );
  });

  it('returns no plan when the movement-evidence check fails', async () => {
    mocks.result.mockResolvedValue({ data: [], error: null });
    mocks.evidence.mockResolvedValue({ data: null, error: { message: 'x' } });
    await expect(fetchCancelRefundPlan(args)).resolves.toBeUndefined();
  });

  it('passes the stored amount paid and goes neutral when it is missing', async () => {
    mocks.result.mockResolvedValue({
      data: [
        {
          amount: 5000,
          currency: 'NGN',
          gateway: 'paystack',
          gateway_reference: 'ref',
          id: 'leg-1',
          status: 'completed',
          transaction_type: 'payment',
        },
      ],
      error: null,
    });
    await fetchCancelRefundPlan({ ...args, amountPaid: '5000.00' });
    expect(getCancelRefundPlan).toHaveBeenCalledWith(
      expect.objectContaining({ amountPaid: 5000 })
    );
    await expect(
      fetchCancelRefundPlan({ ...args, amountPaid: null })
    ).resolves.toMatchObject({ ledgerKnown: false });
  });

  it('goes neutral when captures exceed the stored amount paid', async () => {
    const capture = (id: string) => ({
      amount: 100,
      currency: 'NGN',
      gateway: 'paystack',
      gateway_reference: id,
      id,
      status: 'completed',
      transaction_type: 'payment',
    });
    mocks.result.mockResolvedValue({
      data: [capture('c1'), capture('c2')],
      error: null,
    });
    await expect(
      fetchCancelRefundPlan({ ...args, amountPaid: 100 })
    ).resolves.toMatchObject({ ledgerKnown: false });
  });
});
