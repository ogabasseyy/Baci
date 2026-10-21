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
    const from = vi
      .fn()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second)
      .mockReturnValue(page([]));
    const supabase = { from } as unknown as SupabaseClient;

    const matches = await findPaystackRefundRowsByProviderId(
      supabase,
      42,
      'id, gateway'
    );

    // A limit(2)-style single read returns only corrupt rows and
    // misses the genuine one entirely; the keyset scan advances
    // over the unfiltered page. The trailing call is the stamped-
    // manual scan, which finds nothing here.
    expect(from).toHaveBeenCalledTimes(3);
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

  it('matches stamped manuals by stored provider id without double-counting', async () => {
    const native = { gateway: 'paystack', id: 'row-native' };
    const manual = {
      gateway: 'manual',
      id: 'row-manual',
      metadata: { provider_refund_id: 43 },
    };
    const nativeScan = page([native]);
    // A native row can carry a stored provider id too: the manual
    // scan still reads it, but the code-side gate keeps it out so
    // the same row never counts twice toward ambiguity.
    const manualScan = page([native, manual]);
    const from = vi
      .fn()
      .mockReturnValueOnce(nativeScan)
      .mockReturnValueOnce(manualScan);
    const supabase = { from } as unknown as SupabaseClient;

    const matches = await findPaystackRefundRowsByProviderId(
      supabase,
      42,
      'id, gateway'
    );

    expect(manualScan.eq).toHaveBeenCalledWith(
      'metadata->>provider_refund_id',
      '42'
    );
    expect(matches).toEqual([native, manual]);
  });

  it('finds a lone stamped manual when no native row matches', async () => {
    const manual = { gateway: 'manual', id: 'row-manual' };
    const from = vi
      .fn()
      .mockReturnValueOnce(page([]))
      .mockReturnValueOnce(page([manual]));
    const supabase = { from } as unknown as SupabaseClient;

    const matches = await findPaystackRefundRowsByProviderId(
      supabase,
      42,
      'id, gateway'
    );

    expect(matches).toEqual([manual]);
  });

  it('preserves decimal-text ids past the safe-integer range', async () => {
    const huge = '9007199254740993';
    const nativeScan = page([]);
    const manual = { gateway: 'manual', id: 'row-manual' };
    const manualScan = page([manual]);
    const from = vi
      .fn()
      .mockReturnValueOnce(nativeScan)
      .mockReturnValueOnce(manualScan);
    const supabase = { from } as unknown as SupabaseClient;

    const matches = await findPaystackRefundRowsByProviderId(
      supabase,
      huge,
      'id, gateway'
    );

    // The exact decimal text reaches both predicates: a Number()
    // round-trip would collapse the id to 9007199254740992.
    expect(nativeScan.eq).toHaveBeenCalledWith('gateway_reference', huge);
    expect(manualScan.eq).toHaveBeenCalledWith(
      'metadata->>provider_refund_id',
      huge
    );
    expect(matches).toEqual([manual]);
  });

  it('rejects malformed ids without querying', async () => {
    const from = vi.fn().mockReturnValue(page([]));
    const supabase = { from } as unknown as SupabaseClient;

    for (const bad of ['0', '-7', '12x', '', 0, -3, 1.5]) {
      await expect(
        findPaystackRefundRowsByProviderId(supabase, bad, 'id, gateway')
      ).rejects.toThrow('refund_event_lookup_failed');
    }
    expect(from).not.toHaveBeenCalled();
  });
});
