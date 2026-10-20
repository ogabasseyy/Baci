import { describe, expect, it, vi } from 'vitest';
import { isProviderBackedRefund } from './is-provider-backed-refund';

type Row = {
  gateway: unknown;
  metadata?: Record<string, unknown> | null;
};

function buildSupabase(refundRows: Row[], paymentRows: Row[] = []) {
  let transactionsCalls = 0;
  const from = vi.fn((_table: string) => {
    transactionsCalls += 1;
    const rows = transactionsCalls > 1 ? paymentRows : refundRows;
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn().mockReturnValue(chain);
    chain.eq = vi.fn().mockReturnValue(chain);
    chain.in = vi.fn().mockReturnValue(chain);
    // biome-ignore lint/suspicious/noThenProperty: Supabase query builders are thenable.
    chain.then = (resolve: (value: unknown) => void) =>
      Promise.resolve({ data: rows, error: null }).then(resolve);
    return chain;
  });
  return { from };
}

function check(refundRows: Row[], paymentRows: Row[] = []) {
  return isProviderBackedRefund({
    merchantId: 'merchant-1',
    orderId: 'order-1',
    supabase: buildSupabase(refundRows, paymentRows) as never,
  });
}

describe('isProviderBackedRefund', () => {
  it('counts terminal non-manual refund rows', async () => {
    await expect(
      check([{ gateway: 'manual' }, { gateway: 'paystack' }])
    ).resolves.toBe(true);
  });
  it('fails toward provider copy on unknown gateways', async () => {
    await expect(check([{ gateway: null }, { gateway: '' }])).resolves.toBe(
      true
    );
  });
  it('counts verified manual Paystack attestations', async () => {
    await expect(
      check([
        {
          gateway: 'manual',
          metadata: { method: 'paystack', provider_refund_status: 'processed' },
        },
      ])
    ).resolves.toBe(true);
  });
  it('ignores unverified manual Paystack claims without payment evidence', async () => {
    await expect(
      check([{ gateway: 'manual', metadata: { method: 'paystack' } }], [])
    ).resolves.toBe(false);
  });
  it('counts self-terminal refunded external payments', async () => {
    await expect(
      check([{ gateway: 'manual' }], [{ gateway: 'paypal' }])
    ).resolves.toBe(true);
  });
  it('ignores internal-leg payment flips', async () => {
    await expect(
      check([{ gateway: 'manual' }], [{ gateway: 'wallet' }])
    ).resolves.toBe(false);
  });
  it('skips the payment probe once a refund row qualifies', async () => {
    const supabase = buildSupabase([{ gateway: 'paystack' }]);
    await isProviderBackedRefund({
      merchantId: 'merchant-1',
      orderId: 'order-1',
      supabase: supabase as never,
    });
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });
  it('surfaces lookup failures', async () => {
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn().mockReturnValue(chain);
    chain.eq = vi.fn().mockReturnValue(chain);
    chain.in = vi.fn().mockReturnValue(chain);
    // biome-ignore lint/suspicious/noThenProperty: Supabase query builders are thenable.
    chain.then = (resolve: (value: unknown) => void) =>
      Promise.resolve({ data: null, error: { message: 'down' } }).then(resolve);
    await expect(
      isProviderBackedRefund({
        merchantId: 'merchant-1',
        orderId: 'order-1',
        supabase: { from: vi.fn().mockReturnValue(chain) } as never,
      })
    ).rejects.toThrow('refund_notification_ledger_lookup_failed');
  });
});
