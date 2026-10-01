import { describe, expect, it, vi } from 'vitest';
import { fetchAuditBlockedCancellationLegIds } from './fetch-audit-blocked-cancellation-legs';

const order = { id: 'order-1', merchant_id: 'merchant-1' };

const transactions = [{ id: 'leg-1' }, { id: 'leg-2' }] as never;

function buildSupabase(rows: unknown, error: unknown = null) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.in = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.is = vi.fn().mockResolvedValue({ data: rows, error });
  const from = vi.fn().mockReturnValue(chain);
  return { chain, from, supabase: { from } as never };
}

function review(overrides: Record<string, unknown> = {}) {
  return {
    candidates: null,
    issue_type: 'provider_refund_outside_cancellation',
    metadata: null,
    txn_id: null,
    ...overrides,
  };
}

describe('fetchAuditBlockedCancellationLegIds', () => {
  it('fails closed when the review lookup errors', async () => {
    const { supabase } = buildSupabase(null, new Error('db down'));

    await expect(
      fetchAuditBlockedCancellationLegIds({ order, supabase, transactions })
    ).rejects.toThrow('Unable to verify refund evidence reviews');
  });

  it('blocks nothing when no evidence reviews exist', async () => {
    const { chain, from, supabase } = buildSupabase([]);

    await expect(
      fetchAuditBlockedCancellationLegIds({ order, supabase, transactions })
    ).resolves.toEqual(new Set());

    expect(from).toHaveBeenCalledWith('reconciliation_review');
    expect(chain.in).toHaveBeenCalledWith('issue_type', [
      'order_cancellation_refund_requires_review',
      'provider_refund_outside_cancellation',
    ]);
  });

  it('blocks the leg named by an outside-cancellation review', async () => {
    const { supabase } = buildSupabase([review({ txn_id: 'leg-2' })]);

    await expect(
      fetchAuditBlockedCancellationLegIds({ order, supabase, transactions })
    ).resolves.toEqual(new Set(['leg-2']));
  });

  it('ignores unmarked cancellation reviews but honors marked candidates', async () => {
    const { supabase } = buildSupabase([
      review({
        issue_type: 'order_cancellation_refund_requires_review',
        metadata: null,
        txn_id: 'leg-1',
      }),
      review({
        candidates: [
          { paymentTransactionId: 'leg-2' },
          { payment_transaction_id: 'leg-1' },
        ],
        issue_type: 'order_cancellation_refund_requires_review',
        metadata: { audit_record_failed: true },
      }),
    ]);

    await expect(
      fetchAuditBlockedCancellationLegIds({ order, supabase, transactions })
    ).resolves.toEqual(new Set(['leg-1', 'leg-2']));
  });

  it('blocks every leg when marked evidence names no leg', async () => {
    const { supabase } = buildSupabase([
      review({
        issue_type: 'order_cancellation_refund_requires_review',
        metadata: { audit_record_failed: true },
      }),
    ]);

    await expect(
      fetchAuditBlockedCancellationLegIds({ order, supabase, transactions })
    ).resolves.toEqual(new Set(['leg-1', 'leg-2']));
  });

  it('ignores an outside review whose only evidence is a failed refund', async () => {
    const { supabase } = buildSupabase([
      review({
        metadata: {
          payment_transaction_id: 'leg-1',
          refund_evidence: {
            'provider:7': {
              payment_transaction_id: 'leg-1',
              provider_refund_status: 'failed',
            },
          },
        },
        txn_id: 'leg-1',
      }),
    ]);

    // Paystack definitively rejected the refund, so no money moved:
    // blocking would strand a later genuine cancellation behind
    // delivery_uncertain for nothing.
    await expect(
      fetchAuditBlockedCancellationLegIds({ order, supabase, transactions })
    ).resolves.toEqual(new Set());
  });

  it('still blocks when any outside evidence is not a rejection', async () => {
    const { supabase } = buildSupabase([
      review({
        metadata: {
          payment_transaction_id: 'leg-1',
          refund_evidence: {
            'provider:7': {
              payment_transaction_id: 'leg-1',
              provider_refund_status: 'failed',
            },
            'provider:8': {
              payment_transaction_id: 'leg-1',
              provider_refund_status: 'processed',
            },
          },
        },
        txn_id: 'leg-1',
      }),
    ]);

    await expect(
      fetchAuditBlockedCancellationLegIds({ order, supabase, transactions })
    ).resolves.toEqual(new Set(['leg-1']));
  });

  it('fails closed on malformed outside evidence statuses', async () => {
    const { supabase } = buildSupabase([
      review({
        metadata: {
          payment_transaction_id: 'leg-2',
          refund_evidence: {
            'provider:7': {
              payment_transaction_id: 'leg-2',
              provider_refund_status: null,
            },
          },
        },
        txn_id: 'leg-2',
      }),
    ]);

    await expect(
      fetchAuditBlockedCancellationLegIds({ order, supabase, transactions })
    ).resolves.toEqual(new Set(['leg-2']));
  });
});
