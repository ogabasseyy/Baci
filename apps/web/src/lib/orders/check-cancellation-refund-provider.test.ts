import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./list-paystack-refunds', () => ({ listPaystackRefunds: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('./quarantine-order-cancellation-refund', () => ({
  quarantineRefund: vi.fn(),
}));

import { logger } from '@/lib/logger';
import { checkCancellationRefundProvider } from './check-cancellation-refund-provider';
import { listPaystackRefunds } from './list-paystack-refunds';
import { quarantineRefund } from './quarantine-order-cancellation-refund';
import {
  DeferredError,
  DeliveryUncertainError,
} from './run-order-cancellation-side-effect';

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
describe('checkCancellationRefundProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(quarantineRefund).mockImplementation(async (args) => {
      throw new DeliveryUncertainError(args.reason);
    });
  });
  it('allows submission when there are no prior refunds', async () => {
    vi.mocked(listPaystackRefunds).mockResolvedValue([]);
    await expect(
      checkCancellationRefundProvider(input)
    ).resolves.toBeUndefined();
  });
  it('blocks a refund made directly in Paystack', async () => {
    vi.mocked(listPaystackRefunds).mockResolvedValue([
      { id: 1, amount: 100, currency: 'NGN', status: 'processed' },
    ]);
    await expect(checkCancellationRefundProvider(input)).rejects.toThrow(
      'reconciliation'
    );
  });
  it('fails closed if provider verification is unavailable', async () => {
    vi.mocked(listPaystackRefunds).mockRejectedValue(new Error('network'));
    await expect(checkCancellationRefundProvider(input)).rejects.toThrow(
      'Unable to verify'
    );
  });
  it('logs verification outages for ops alerting', async () => {
    const failure = new Error('Paystack refund verification unavailable');
    vi.mocked(listPaystackRefunds).mockRejectedValue(failure);
    await expect(checkCancellationRefundProvider(input)).rejects.toThrow(
      'Unable to verify'
    );
    expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
      expect.objectContaining({
        error: failure,
        message: 'Cancellation refund provider verification failed',
        reference: 'capture-1',
      })
    );
  });
  it('allows accounted processed refunds but blocks pending ones', async () => {
    vi.mocked(listPaystackRefunds).mockResolvedValue([
      { id: 1, amount: 100, currency: 'NGN', status: 'processed' },
    ]);
    await expect(
      checkCancellationRefundProvider({
        ...input,
        knownRefunds: [
          { gateway_reference: '1', amount: 1, status: 'completed' },
        ],
      })
    ).resolves.toBeUndefined();
    vi.mocked(listPaystackRefunds).mockResolvedValue([
      { id: 1, amount: 100, currency: 'NGN', status: 'pending' },
    ]);
    await expect(checkCancellationRefundProvider(input)).rejects.toThrow(
      'reconciliation'
    );
  });
  it('forwards the absolute deadline to the refund lister', async () => {
    vi.mocked(listPaystackRefunds).mockResolvedValue([]);
    const deadlineMs = Date.now() + 42_000;
    await checkCancellationRefundProvider({ ...input, deadlineMs });
    expect(vi.mocked(listPaystackRefunds)).toHaveBeenCalledWith(
      'capture-1',
      expect.objectContaining({ deadlineMs })
    );
  });
  it('treats legacy refunded rows as reconciled like completed ones', async () => {
    vi.mocked(listPaystackRefunds).mockResolvedValue([
      { id: 1, amount: 100, currency: 'NGN', status: 'processed' },
    ]);
    await expect(
      checkCancellationRefundProvider({
        ...input,
        knownRefunds: [
          { gateway_reference: '1', amount: 1, status: 'refunded' },
        ],
      })
    ).resolves.toBeUndefined();
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
    ).resolves.toBeUndefined();
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
    ).resolves.toBeUndefined();
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
  it('ignores failed provider rows before the amount gate', async () => {
    vi.mocked(listPaystackRefunds).mockResolvedValue([
      { id: 1, amount: 999, currency: 'USD', status: 'failed' },
    ]);
    await expect(
      checkCancellationRefundProvider(input)
    ).resolves.toBeUndefined();
  });
  it('matches padded ledger references to provider rows', async () => {
    vi.mocked(listPaystackRefunds).mockResolvedValue([
      { id: 1, amount: 100, currency: 'NGN', status: 'processed' },
    ]);
    await expect(
      checkCancellationRefundProvider({
        ...input,
        knownRefunds: [
          {
            gateway_reference: ' 1 ',
            amount: 1,
            currency: 'NGN',
            status: 'completed',
          },
        ],
      })
    ).resolves.toBeUndefined();
  });
  it('compares currencies case-insensitively like the claim gate', async () => {
    vi.mocked(listPaystackRefunds).mockResolvedValue([
      { id: 1, amount: 100, currency: 'ngn', status: 'processed' },
    ]);
    await expect(
      checkCancellationRefundProvider({
        ...input,
        currency: ' NGN ',
        knownRefunds: [
          {
            gateway_reference: '1',
            amount: 1,
            currency: 'ngn',
            status: 'completed',
          },
        ],
      })
    ).resolves.toBeUndefined();
  });
  it('defers when the listing exhausts its budget instead of terminalizing', async () => {
    const timeout = new Error('The operation timed out');
    timeout.name = 'TimeoutError';
    vi.mocked(listPaystackRefunds).mockRejectedValue(timeout);
    await expect(checkCancellationRefundProvider(input)).rejects.toThrow(
      DeferredError
    );
    await expect(checkCancellationRefundProvider(input)).rejects.toThrow(
      'deferred_for_budget'
    );
    expect(vi.mocked(quarantineRefund)).not.toHaveBeenCalled();
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    vi.mocked(listPaystackRefunds).mockRejectedValue(abort);
    await expect(checkCancellationRefundProvider(input)).rejects.toThrow(
      'deferred_for_budget'
    );
  });
  it('files a review carrying the leg and provider evidence', async () => {
    vi.mocked(listPaystackRefunds).mockResolvedValue([
      { id: 9, amount: 100, currency: 'NGN', status: 'pending' },
    ]);
    await expect(checkCancellationRefundProvider(input)).rejects.toThrow(
      'reconciliation'
    );
    expect(vi.mocked(quarantineRefund)).toHaveBeenCalledWith(
      expect.objectContaining({
        preflight: true,
        transactions: [leg],
        metadata: expect.objectContaining({
          provider: 'paystack',
          provider_reference: 'capture-1',
          failed_payment_transaction_id: 'leg-1',
          payment_transaction_id: 'leg-1',
          provider_refund_id: 9,
        }),
      })
    );
  });
});
