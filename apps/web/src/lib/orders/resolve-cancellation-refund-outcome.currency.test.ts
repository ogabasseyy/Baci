import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn() } }));

import { resolveCancellationRefundOutcome } from './resolve-cancellation-refund-outcome';
import {
  leg,
  manual,
  supabaseWith,
} from './resolve-cancellation-refund-outcome.test-support';

describe('resolveCancellationRefundOutcome currency and evidence gates', () => {
  it('reports the currency code normalized like the worker', async () => {
    const supabase = supabaseWith({
      ledger: { data: [leg({ currency: ' ngn ' })], error: null },
    });
    await expect(
      resolveCancellationRefundOutcome({ ...manual, supabase })
    ).resolves.toMatchObject({ details: { currency: 'NGN' } });
  });

  it('reports unknown while an unresolved movement review is open', async () => {
    await expect(
      resolveCancellationRefundOutcome({
        ...manual,
        supabase: supabaseWith({ evidence: { data: true, error: null } }),
      })
    ).resolves.toEqual({ outcome: 'unknown' });
  });

  it('reports unknown when the movement-evidence check fails', async () => {
    await expect(
      resolveCancellationRefundOutcome({
        ...manual,
        supabase: supabaseWith({
          evidence: { data: null, error: { message: 'x' } },
        }),
      })
    ).resolves.toEqual({ outcome: 'unknown' });
  });

  it('reports unknown for a single USD capture on an NGN order', async () => {
    const supabase = supabaseWith({
      ledger: { data: [leg({ currency: 'USD' })], error: null },
    });
    await expect(
      resolveCancellationRefundOutcome({ ...manual, supabase })
    ).resolves.toEqual({ outcome: 'unknown' });
  });

  it('defaults a blank order currency to NGN like the worker', async () => {
    const supabase = supabaseWith({
      mode: {
        data: {
          amount_paid: 5000,
          cancellation_refund_mode: 'manual',
          currency: '',
        },
        error: null,
      },
    });
    await expect(
      resolveCancellationRefundOutcome({ ...manual, supabase })
    ).resolves.toMatchObject({ outcome: 'manual_required' });
  });

  it('reports unknown when the order currency cannot be read', async () => {
    const supabase = supabaseWith({
      mode: { data: null, error: { message: 'x' } },
    });
    await expect(
      resolveCancellationRefundOutcome({ ...manual, supabase })
    ).resolves.toEqual({ outcome: 'unknown' });
  });

  it('labels the details with the order currency, not an earlier failed USD attempt', async () => {
    const supabase = supabaseWith({
      ledger: {
        data: [
          leg({ amount: 4000, currency: 'USD', id: 'usd-1', status: 'failed' }),
          leg({ amount: 3000, id: 'leg-1' }),
          leg({ amount: 2000, id: 'leg-2', status: 'refund_pending' }),
        ],
        error: null,
      },
    });
    await expect(
      resolveCancellationRefundOutcome({ ...manual, supabase })
    ).resolves.toMatchObject({
      details: { currency: 'NGN', inFlightAmount: 2000, remainingAmount: 3000 },
      outcome: 'manual_required',
    });
  });
});
