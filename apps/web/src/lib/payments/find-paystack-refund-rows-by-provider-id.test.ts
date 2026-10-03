import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { findPaystackRefundRowsByProviderId } from './find-paystack-refund-rows-by-provider-id';

function page(rows: unknown[], error: unknown = null) {
  const builder: Record<string, unknown> = {};
  for (const key of ['select', 'eq', 'ilike', 'order', 'limit', 'gt']) {
    builder[key] = vi.fn().mockReturnValue(builder);
  }
  // biome-ignore lint/suspicious/noThenProperty: Supabase query builders are thenable.
  builder.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve({ data: rows, error }).then(resolve);
  return builder;
}

describe('findPaystackRefundRowsByProviderId', () => {
  it('returns the genuine row past corrupt prefilter matches', async () => {
    const corrupt = Array.from({ length: 10 }, (_, index) => ({
      gateway: 'notpaystack',
      id: `row-corrupt-${index}`,
    }));
    const genuine = { gateway: ' Paystack ', id: 'row-genuine' };
    const first = page(corrupt);
    const second = page([genuine]);
    const from = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const supabase = { from } as unknown as SupabaseClient;

    const matches = await findPaystackRefundRowsByProviderId(
      supabase,
      42,
      'id, gateway'
    );

    // A limit(2)-style single read returns only corrupt rows and
    // misses the genuine one entirely; the keyset scan advances
    // over the unfiltered page.
    expect(from).toHaveBeenCalledTimes(2);
    expect(second.gt).toHaveBeenCalledWith('id', 'row-corrupt-9');
    expect(matches).toEqual([genuine]);
  });

  it('stops at two genuine rows for ambiguity detection', async () => {
    const rows = [
      { gateway: 'paystack', id: 'row-1' },
      { gateway: 'PAYSTACK', id: 'row-2' },
      { gateway: 'paystack', id: 'row-3' },
    ];
    const from = vi.fn().mockReturnValue(page(rows));
    const supabase = { from } as unknown as SupabaseClient;

    const matches = await findPaystackRefundRowsByProviderId(
      supabase,
      42,
      'id, gateway'
    );

    expect(matches).toEqual([rows[0], rows[1]]);
    expect(from).toHaveBeenCalledTimes(1);
  });

  it('throws a lookup failure when the read errors', async () => {
    const from = vi.fn().mockReturnValue(page([], new Error('db down')));
    const supabase = { from } as unknown as SupabaseClient;

    await expect(
      findPaystackRefundRowsByProviderId(supabase, 42, 'id, gateway')
    ).rejects.toThrow('refund_event_lookup_failed');
  });
});
