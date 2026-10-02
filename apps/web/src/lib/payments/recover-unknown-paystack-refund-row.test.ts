import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  lookupLocalRefundByProviderId,
  reconcileRecoveredRow,
} from './recover-unknown-paystack-refund-row';

const mocks = vi.hoisted(() => ({
  fileRefundEvidenceReview: vi.fn(),
  holdPaystackRefundForReview: vi.fn(),
  reconcilePaystackCancellationRefund: vi.fn(),
}));

vi.mock('./reconcile-paystack-cancellation-refund', () => ({
  reconcilePaystackCancellationRefund:
    mocks.reconcilePaystackCancellationRefund,
}));
vi.mock('./file-refund-evidence-review', () => ({
  fileRefundEvidenceReview: mocks.fileRefundEvidenceReview,
}));
vi.mock('./hold-paystack-refund-for-review', () => ({
  holdPaystackRefundForReview: mocks.holdPaystackRefundForReview,
}));

const refund = {
  amount: 100,
  currency: 'NGN',
  gateway: 'paystack',
  gateway_reference: '202',
  id: 'refund-1',
  merchant_id: 'merchant-1',
  metadata: {},
  order_id: 'order-1',
  status: 'refund_pending',
};

function lookupQuery(data: unknown, error: unknown = null) {
  const query: {
    eq: ReturnType<typeof vi.fn>;
    ilike: ReturnType<typeof vi.fn>;
    limit: ReturnType<typeof vi.fn>;
  } = {
    eq: vi.fn(),
    ilike: vi.fn(),
    limit: vi.fn().mockResolvedValue({ data, error }),
  };
  query.eq.mockReturnValue(query);
  query.ilike.mockReturnValue(query);
  return query;
}

function database(data: unknown, error: unknown = null) {
  const query = lookupQuery(data, error);
  const select = vi.fn().mockReturnValue(query);
  const from = vi.fn().mockReturnValue({ select });
  return {
    from,
    query,
    supabase: { from } as unknown as SupabaseClient,
  };
}

describe('lookupLocalRefundByProviderId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the local refund row for the provider id', async () => {
    const { from, query, supabase } = database([refund]);

    const result = await lookupLocalRefundByProviderId(supabase, 202);

    expect(result).toEqual(refund);
    expect(from).toHaveBeenCalledWith('transactions');
    expect(query.eq).toHaveBeenCalledWith('transaction_type', 'refund');
    expect(query.ilike).toHaveBeenCalledWith('gateway', '%paystack%');
    expect(query.eq).toHaveBeenCalledWith('gateway_reference', '202');
  });

  it('matches a held legacy row despite padded gateway casing', async () => {
    const legacy = { ...refund, gateway: ' Paystack ' };
    const { supabase } = database([legacy]);

    const result = await lookupLocalRefundByProviderId(supabase, 202);

    expect(result).toEqual(legacy);
  });

  it('throws when duplicate audit rows share the provider id', async () => {
    const { supabase } = database([
      refund,
      { ...refund, gateway: ' Paystack ', id: 'refund-2' },
    ]);

    await expect(lookupLocalRefundByProviderId(supabase, 202)).rejects.toThrow(
      'refund_event_lookup_failed'
    );
  });

  it('returns null when no row matches', async () => {
    const { supabase } = database([]);

    const result = await lookupLocalRefundByProviderId(supabase, 202);

    expect(result).toBeNull();
  });

  it('throws when the lookup fails', async () => {
    const { supabase } = database(null, new Error('db down'));

    await expect(lookupLocalRefundByProviderId(supabase, 202)).rejects.toThrow(
      'refund_event_lookup_failed'
    );
  });
});

describe('reconcileRecoveredRow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.reconcilePaystackCancellationRefund.mockResolvedValue('updated');
  });

  it('reconciles through on success, files and holds on deterministic failure', async () => {
    const { supabase } = database(null);

    await reconcileRecoveredRow(supabase, refund);

    expect(mocks.reconcilePaystackCancellationRefund).toHaveBeenCalledWith(
      supabase,
      refund
    );
    expect(mocks.fileRefundEvidenceReview).not.toHaveBeenCalled();
    expect(mocks.holdPaystackRefundForReview).not.toHaveBeenCalled();

    mocks.reconcilePaystackCancellationRefund.mockRejectedValueOnce(
      new Error('paystack_refund_evidence_mismatch')
    );

    await reconcileRecoveredRow(supabase, refund);

    expect(mocks.fileRefundEvidenceReview).toHaveBeenCalledWith(
      supabase,
      refund,
      'paystack_refund_evidence_mismatch'
    );
    expect(mocks.holdPaystackRefundForReview).toHaveBeenCalledWith(
      supabase,
      'refund-1',
      'paystack_refund_evidence_mismatch'
    );
  });

  it('rethrows non-deterministic errors without filing', async () => {
    const { supabase } = database(null);
    mocks.reconcilePaystackCancellationRefund.mockRejectedValueOnce(
      new Error('boom')
    );

    await expect(reconcileRecoveredRow(supabase, refund)).rejects.toThrow(
      'boom'
    );
    expect(mocks.fileRefundEvidenceReview).not.toHaveBeenCalled();
    expect(mocks.holdPaystackRefundForReview).not.toHaveBeenCalled();
  });
});
