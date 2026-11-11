import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn() } }));

import { resolveCancellationRefundOutcome } from './resolve-cancellation-refund-outcome';
import {
  base,
  leg,
  manual,
  supabaseWith,
} from './resolve-cancellation-refund-outcome.test-support';

describe('resolveCancellationRefundOutcome', () => {
  it('reports a queued automatic refund without reading the ledger', async () => {
    await expect(
      resolveCancellationRefundOutcome({
        ...base,
        alreadyCancelled: false,
        requested: 'automatic',
        supabase: supabaseWith(),
      })
    ).resolves.toEqual({ outcome: 'queued_if_required' });
  });

  it('reports manual_required with the remaining amount for a cancel-only order', async () => {
    await expect(
      resolveCancellationRefundOutcome({ ...manual, supabase: supabaseWith() })
    ).resolves.toEqual({
      details: { currency: 'NGN', inFlightAmount: 0, remainingAmount: 5000 },
      outcome: 'manual_required',
    });
  });

  it('splits the in-flight amount from what the merchant must refund', async () => {
    const supabase = supabaseWith({
      ledger: {
        data: [
          leg({ amount: 3000 }),
          leg({ amount: 2000, id: 'leg-2', status: 'refund_pending' }),
        ],
        error: null,
      },
    });
    await expect(
      resolveCancellationRefundOutcome({ ...manual, supabase })
    ).resolves.toEqual({
      details: { currency: 'NGN', inFlightAmount: 2000, remainingAmount: 3000 },
      outcome: 'manual_required',
    });
  });

  it('needs nothing from the merchant when everything is already in flight', async () => {
    const supabase = supabaseWith({
      ledger: { data: [leg({ status: 'refund_pending' })], error: null },
    });
    await expect(
      resolveCancellationRefundOutcome({ ...manual, supabase })
    ).resolves.toEqual({
      details: { currency: 'NGN', inFlightAmount: 5000, remainingAmount: 0 },
      outcome: 'queued_if_required',
    });
  });

  it('reports unknown when the ledger or the persisted mode cannot be read', async () => {
    await expect(
      resolveCancellationRefundOutcome({
        ...manual,
        supabase: supabaseWith({
          ledger: { data: null, error: { message: 'x' } },
        }),
      })
    ).resolves.toEqual({ outcome: 'unknown' });
    await expect(
      resolveCancellationRefundOutcome({
        ...manual,
        alreadyCancelled: true,
        supabase: supabaseWith({
          mode: { data: null, error: { message: 'x' } },
        }),
      })
    ).resolves.toEqual({ outcome: 'unknown' });
  });

  it('uses the persisted automatic mode on a replay that asked for manual', async () => {
    await expect(
      resolveCancellationRefundOutcome({
        ...manual,
        alreadyCancelled: true,
        supabase: supabaseWith(),
      })
    ).resolves.toEqual({ outcome: 'queued_if_required' });
  });

  it('does not ask for a manual refund on a replay once the full refund was recorded', async () => {
    const supabase = supabaseWith({
      ledger: {
        data: [
          leg(),
          leg({
            id: 'refund-1',
            payment_transaction_id: 'leg-1',
            provider_refund_status: 'processed',
            transaction_type: 'refund',
          }),
        ],
        error: null,
      },
      mode: {
        data: { amount_paid: 5000, cancellation_refund_mode: 'manual' },
        error: null,
      },
    });
    await expect(
      resolveCancellationRefundOutcome({
        ...manual,
        alreadyCancelled: true,
        supabase,
      })
    ).resolves.toEqual({
      details: { currency: 'NGN', inFlightAmount: 0, remainingAmount: 0 },
      outcome: 'queued_if_required',
    });
  });

  it('treats a pending refund row as in flight, not as owed by the merchant', async () => {
    const supabase = supabaseWith({
      ledger: {
        data: [
          leg(),
          leg({
            id: 'refund-1',
            payment_transaction_id: 'leg-1',
            status: 'processing',
            transaction_type: 'refund',
          }),
        ],
        error: null,
      },
    });
    await expect(
      resolveCancellationRefundOutcome({ ...manual, supabase })
    ).resolves.toEqual({
      details: { currency: 'NGN', inFlightAmount: 5000, remainingAmount: 0 },
      outcome: 'queued_if_required',
    });
  });

  it('reports unknown when an unlinked refund cannot be attributed to one leg', async () => {
    const supabase = supabaseWith({
      ledger: {
        data: [
          leg({ id: 'a' }),
          leg({ id: 'b' }),
          leg({
            id: 'refund-1',
            payment_transaction_id: null,
            transaction_type: 'refund',
          }),
        ],
        error: null,
      },
    });
    await expect(
      resolveCancellationRefundOutcome({ ...manual, supabase })
    ).resolves.toEqual({ outcome: 'unknown' });
  });

  it('reports unknown for an unlinked in-flight refund even with a single payment leg', async () => {
    const supabase = supabaseWith({
      ledger: {
        data: [
          leg(),
          leg({
            id: 'refund-1',
            payment_transaction_id: null,
            status: 'processing',
            transaction_type: 'refund',
          }),
        ],
        error: null,
      },
    });
    await expect(
      resolveCancellationRefundOutcome({ ...manual, supabase })
    ).resolves.toEqual({ outcome: 'unknown' });
  });

  it('reports unknown when a refund is linked to a payment this order does not have', async () => {
    const supabase = supabaseWith({
      ledger: {
        data: [
          leg(),
          leg({
            id: 'refund-1',
            payment_transaction_id: 'pay-gone',
            transaction_type: 'refund',
          }),
        ],
        error: null,
      },
    });
    await expect(
      resolveCancellationRefundOutcome({ ...manual, supabase })
    ).resolves.toEqual({ outcome: 'unknown' });
  });
});
