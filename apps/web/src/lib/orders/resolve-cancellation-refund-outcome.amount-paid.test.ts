import { describe, expect, it, vi } from 'vitest';
import { resolveCancellationRefundOutcome } from './resolve-cancellation-refund-outcome';
import {
  leg,
  manual,
  supabaseWith,
} from './resolve-cancellation-refund-outcome.test-support';

const withOrder = (data: Record<string, unknown>, legs = [leg()]) =>
  supabaseWith({
    ledger: { data: legs, error: null },
    mode: {
      data: { cancellation_refund_mode: 'manual', currency: 'NGN', ...data },
      error: null,
    },
  });

describe('resolveCancellationRefundOutcome recorded amount paid', () => {
  it('reports unknown when two uncovered captures exceed amount_paid', async () => {
    const supabase = withOrder({ amount_paid: 100 }, [
      leg({ amount: 100, id: 'cap-1' }),
      leg({ amount: 100, id: 'cap-2' }),
    ]);
    await expect(
      resolveCancellationRefundOutcome({ ...manual, supabase })
    ).resolves.toEqual({ outcome: 'unknown' });
  });

  it('reports unknown when amount_paid is missing', async () => {
    await expect(
      resolveCancellationRefundOutcome({
        ...manual,
        supabase: withOrder({ amount_paid: null }),
      })
    ).resolves.toEqual({ outcome: 'unknown' });
  });

  it('still reports manual_required when the capture fits amount_paid', async () => {
    await expect(
      resolveCancellationRefundOutcome({
        ...manual,
        supabase: withOrder({ amount_paid: '5000.00' }),
      })
    ).resolves.toMatchObject({ outcome: 'manual_required' });
  });
});

describe('resolveCancellationRefundOutcome order status and total', () => {
  it('selects the real payment status and total with the merchant scope', async () => {
    const select = vi.fn(() => ({
      eq: () => ({
        eq: () => ({
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              amount_paid: 5000,
              currency: 'NGN',
              payment_status: 'refunded',
              total: 5000,
            },
            error: null,
          }),
        }),
      }),
    }));
    const base = withOrder({}) as unknown as {
      from: (table: string) => unknown;
      rpc: unknown;
    };
    const supabase = {
      ...base,
      from: (table: string) =>
        table === 'orders' ? { select } : base.from(table),
    } as never;
    await expect(
      resolveCancellationRefundOutcome({ ...manual, supabase })
    ).resolves.toMatchObject({ outcome: 'manual_required' });
    expect(select).toHaveBeenCalledWith(
      'currency, amount_paid, payment_status, total'
    );
  });

  it('does not let a larger order total mask captures above amount_paid', async () => {
    const supabase = withOrder(
      { amount_paid: 100, total: 1000, payment_status: 'paid' },
      [leg({ amount: 100, id: 'cap-1' }), leg({ amount: 100, id: 'cap-2' })]
    );
    await expect(
      resolveCancellationRefundOutcome({ ...manual, supabase })
    ).resolves.toEqual({ outcome: 'unknown' });
  });
});
