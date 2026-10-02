import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./list-paystack-refunds', () => ({ listPaystackRefunds: vi.fn() }));

import { checkCancellationRefundProvider } from './check-cancellation-refund-provider';
import { listPaystackRefunds } from './list-paystack-refunds';

const input = { reference: 'capture-1', currency: 'NGN', knownRefunds: [] };
describe('checkCancellationRefundProvider', () => {
  beforeEach(() => vi.clearAllMocks());
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
});
