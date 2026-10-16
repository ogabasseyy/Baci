import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./list-paystack-refunds', () => ({ listPaystackRefunds: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('./quarantine-order-cancellation-refund', () => ({
  quarantineRefund: vi.fn(),
}));

import { checkCancellationRefundProvider } from './check-cancellation-refund-provider';
import { listPaystackRefunds } from './list-paystack-refunds';
import { quarantineRefund } from './quarantine-order-cancellation-refund';
import { DeliveryUncertainError } from './run-order-cancellation-side-effect';

const leg = {
  amount: 100,
  currency: 'NGN',
  gateway: 'paystack',
  gateway_reference: 'capture-1',
  id: 'leg-1',
  status: 'completed',
};
const input = {
  reference: 'capture-1',
  currency: 'NGN',
  knownRefunds: [],
  order: { id: 'order-1', merchant_id: 'm-1', currency: 'NGN' },
  supabase: {},
  transaction: leg,
} as unknown as Parameters<typeof checkCancellationRefundProvider>[0];
describe('checkCancellationRefundProvider manual pairing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(quarantineRefund).mockImplementation(async (args) => {
      throw new DeliveryUncertainError(args.reason);
    });
  });
  it('accounts unmatched processed refunds against completed manual Paystack rows', async () => {
    vi.mocked(listPaystackRefunds).mockResolvedValue([
      { id: 7, amount: 100, currency: 'NGN', status: 'processed' },
    ]);
    await expect(
      checkCancellationRefundProvider({
        ...input,
        knownRefunds: [
          {
            gateway_reference: 'merchant-ref-1',
            amount: 1,
            status: 'completed',
            currency: 'NGN',
            metadata: { method: 'paystack' },
          },
        ],
      })
    ).resolves.toEqual([{ kobo: 100, providerRefundId: 7 }]);
  });
  it('reserves stamped ids before pairing unstamped claims', async () => {
    // A stamped partial and a newer same-sized partial: the old id is
    // already persisted, so only the new provider refund pairs. Without
    // reservation both rows would consume pairs and the stamp — which
    // skips stamped rows — would persist the old id onto the new row
    // while the new provider refund stays unlinked.
    vi.mocked(listPaystackRefunds).mockResolvedValue([
      { id: 7, amount: 100, currency: 'NGN', status: 'processed' },
      { id: 8, amount: 100, currency: 'NGN', status: 'processed' },
    ]);
    await expect(
      checkCancellationRefundProvider({
        ...input,
        knownRefunds: [
          {
            gateway_reference: 'merchant-ref-1',
            amount: 1,
            status: 'completed',
            currency: 'NGN',
            metadata: {
              method: 'paystack',
              provider_refund_id: 7,
              provider_refund_status: 'processed',
            },
          },
          {
            gateway_reference: 'merchant-ref-2',
            amount: 1,
            status: 'completed',
            currency: 'NGN',
            metadata: { method: 'paystack' },
          },
        ],
      })
    ).resolves.toEqual([{ kobo: 100, providerRefundId: 8 }]);
  });

  it('still blocks when manual Paystack rows cannot cover the provider refund', async () => {
    vi.mocked(listPaystackRefunds).mockResolvedValue([
      { id: 7, amount: 200, currency: 'NGN', status: 'processed' },
    ]);
    const manual = {
      gateway_reference: 'merchant-ref-1',
      amount: 1,
      status: 'completed',
      currency: 'NGN',
      metadata: { method: 'paystack' },
    };
    await expect(
      checkCancellationRefundProvider({ ...input, knownRefunds: [manual] })
    ).rejects.toThrow('reconciliation');
    // A manual row in another currency cannot account for this leg.
    await expect(
      checkCancellationRefundProvider({
        ...input,
        knownRefunds: [{ ...manual, amount: 2, currency: 'USD' }],
      })
    ).rejects.toThrow('reconciliation');
    // A manual row already matched by reference cannot account twice.
    vi.mocked(listPaystackRefunds).mockResolvedValue([
      { id: 7, amount: 100, currency: 'NGN', status: 'processed' },
      { id: 8, amount: 100, currency: 'NGN', status: 'processed' },
    ]);
    await expect(
      checkCancellationRefundProvider({
        ...input,
        knownRefunds: [{ ...manual, gateway_reference: '7' }],
      })
    ).rejects.toThrow('reconciliation');
  });
  it('quarantines leftover manual pool the provider does not confirm', async () => {
    vi.mocked(listPaystackRefunds).mockResolvedValue([
      { id: 7, amount: 60, currency: 'NGN', status: 'processed' },
    ]);
    await expect(
      checkCancellationRefundProvider({
        ...input,
        knownRefunds: [
          {
            gateway_reference: 'merchant-ref-1',
            amount: 1,
            status: 'completed',
            currency: 'NGN',
            metadata: { method: 'paystack' },
          },
        ],
      })
    ).rejects.toThrow('reconciliation');
    // No provider rows at all with a Paystack manual claim also quarantines.
    vi.mocked(listPaystackRefunds).mockResolvedValue([]);
    await expect(
      checkCancellationRefundProvider({
        ...input,
        knownRefunds: [
          {
            gateway_reference: 'merchant-ref-1',
            amount: 1,
            status: 'completed',
            currency: 'NGN',
            metadata: { method: 'paystack' },
          },
        ],
      })
    ).rejects.toThrow('exceed provider-confirmed amounts');
  });
  it('requires exact single-row correspondence for unmatched processed rows', async () => {
    const manual = (reference: string, amount: number) => ({
      gateway_reference: reference,
      amount,
      status: 'completed',
      currency: 'NGN',
      metadata: { method: 'paystack' },
    });
    // A+B same-amount case: one manual row cannot cover two provider rows.
    vi.mocked(listPaystackRefunds).mockResolvedValue([
      { id: 7, amount: 100, currency: 'NGN', status: 'processed' },
      { id: 8, amount: 100, currency: 'NGN', status: 'processed' },
    ]);
    await expect(
      checkCancellationRefundProvider({
        ...input,
        knownRefunds: [manual('merchant-ref-1', 1)],
      })
    ).rejects.toThrow('reconciliation');
    // Two exact pairs pass.
    await expect(
      checkCancellationRefundProvider({
        ...input,
        knownRefunds: [
          manual('merchant-ref-1', 1),
          manual('merchant-ref-2', 1),
        ],
      })
    ).resolves.toEqual([
      { kobo: 100, providerRefundId: 7 },
      { kobo: 100, providerRefundId: 8 },
    ]);
    // A combined manual cannot cover two smaller provider rows.
    vi.mocked(listPaystackRefunds).mockResolvedValue([
      { id: 7, amount: 60, currency: 'NGN', status: 'processed' },
      { id: 8, amount: 40, currency: 'NGN', status: 'processed' },
    ]);
    await expect(
      checkCancellationRefundProvider({
        ...input,
        knownRefunds: [manual('merchant-ref-1', 1)],
      })
    ).rejects.toThrow('reconciliation');
  });
  it('pairs legacy refunded-status manual rows like completed ones', async () => {
    // An exact processed pair passes for the refunded status too.
    vi.mocked(listPaystackRefunds).mockResolvedValue([
      { id: 7, amount: 100, currency: 'NGN', status: 'processed' },
    ]);
    const refundedManual = {
      gateway_reference: 'merchant-ref-1',
      amount: 1,
      status: 'refunded',
      currency: 'NGN',
      metadata: { method: 'paystack' },
    };
    await expect(
      checkCancellationRefundProvider({
        ...input,
        knownRefunds: [refundedManual],
      })
    ).resolves.toEqual([{ kobo: 100, providerRefundId: 7 }]);
    // And an empty provider listing leaves it unpaired: without this
    // the caller would stamp proof no provider row confirms.
    vi.mocked(listPaystackRefunds).mockResolvedValue([]);
    await expect(
      checkCancellationRefundProvider({
        ...input,
        knownRefunds: [refundedManual],
      })
    ).rejects.toThrow('exceed provider-confirmed amounts');
  });
});
