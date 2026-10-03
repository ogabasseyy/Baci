import { describe, expect, it, vi } from 'vitest';
import { hasSettledPaystackOrderPaymentReference } from './has-settled-paystack-order-payment-reference';

function database(pages: unknown[][]) {
  const builders = pages.map((rows) => {
    const builder: Record<string, unknown> = {};
    for (const key of ['select', 'ilike', 'eq', 'order', 'limit', 'gt']) {
      builder[key] = vi.fn().mockReturnValue(builder);
    }
    // biome-ignore lint/suspicious/noThenProperty: Supabase query builders are thenable.
    builder.then = (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(resolve);
    return builder;
  });
  const from = vi.fn();
  for (const builder of builders) from.mockReturnValueOnce(builder);
  from.mockReturnValue(builders[builders.length - 1]);
  const supabase = { from } as unknown as Parameters<
    typeof hasSettledPaystackOrderPaymentReference
  >[0]['supabase'];
  return { from, supabase };
}

describe('hasSettledPaystackOrderPaymentReference', () => {
  it('returns true when a completed Paystack order payment owns the reference', async () => {
    const { supabase } = database([
      [{ gateway: 'paystack', id: 'tx-1', order_id: 'order-1' }],
    ]);

    await expect(
      hasSettledPaystackOrderPaymentReference({
        gatewayReference: 'R1',
        supabase,
      })
    ).resolves.toBe(true);
  });

  it('returns false when no completed Paystack order payment matches', async () => {
    const { supabase } = database([[]]);

    await expect(
      hasSettledPaystackOrderPaymentReference({
        gatewayReference: 'R1',
        supabase,
      })
    ).resolves.toBe(false);
  });

  it.each([
    'Paystack',
    ' paystack ',
  ])('returns true for a legacy payment stored as %s', async (gateway) => {
    const { supabase } = database([
      [{ gateway, id: 'tx-1', order_id: 'order-1' }],
    ]);

    await expect(
      hasSettledPaystackOrderPaymentReference({
        gatewayReference: 'R1',
        supabase,
      })
    ).resolves.toBe(true);
  });

  it('ignores order-less completed payments', async () => {
    const { supabase } = database([
      [{ gateway: 'paystack', id: 'tx-1', order_id: null }],
    ]);

    await expect(
      hasSettledPaystackOrderPaymentReference({
        gatewayReference: 'R1',
        supabase,
      })
    ).resolves.toBe(false);
  });

  it('finds the genuine leg past corrupt prefilter matches', async () => {
    // A limit(1) ilike read can return only `notpaystack` and miss
    // the completed leg; the full normalized scan must not.
    const corrupt = Array.from({ length: 10 }, (_, index) => ({
      gateway: 'notpaystack',
      id: `tx-corrupt-${index}`,
      order_id: 'order-9',
    }));
    const { supabase } = database([
      corrupt,
      [{ gateway: 'paystack', id: 'tx-1', order_id: 'order-1' }],
    ]);

    await expect(
      hasSettledPaystackOrderPaymentReference({
        gatewayReference: 'R1',
        supabase,
      })
    ).resolves.toBe(true);
  });
});
