import { beforeEach, describe, expect, it, vi } from 'vitest';
import { replayFor, runImeiLookup } from './run-imei-lookup';

vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ execute: vi.fn(), start: vi.fn() }));
vi.mock('./execute-imei-lookup', () => ({ executeImeiLookup: mocks.execute }));
vi.mock('./route-helpers', () => ({ mapExistingLookup: () => 'replayed' }));
vi.mock('./wallet-pay/start-imei-wallet-payment', () => ({
  startImeiWalletPayment: mocks.start,
}));

beforeEach(() => vi.resetAllMocks());

describe('runImeiLookup', () => {
  it('keeps store credit on the existing flow, without the user field', async () => {
    mocks.execute.mockResolvedValue('legacy');
    await expect(
      runImeiLookup('store_credit', {
        merchantId: 'm',
        user: { id: 'u' },
      } as never)
    ).resolves.toBe('legacy');
    expect(mocks.execute).toHaveBeenCalledWith({ merchantId: 'm' });
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it('starts a PiggyVest wallet payment instead of debiting store credit', async () => {
    mocks.start.mockResolvedValue('piggyvest');
    await expect(
      runImeiLookup('piggyvest_wallet', {
        merchantId: 'm',
        user: { id: 'u' },
      } as never)
    ).resolves.toBe('piggyvest');
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('lets a lost PiggyVest start response replay through the payment start step', () => {
    const pending = { status: 'pending' } as never;
    expect(
      replayFor(pending, { paymentMethod: 'piggyvest_wallet' }, {} as never)
    ).toBeNull();
  });

  it('answers every other replay exactly as before', () => {
    expect(
      replayFor(
        { status: 'pending' } as never,
        { paymentMethod: 'store_credit' },
        {} as never
      )
    ).toBe('replayed');
    expect(
      replayFor(
        { status: 'completed' } as never,
        { paymentMethod: 'piggyvest_wallet' },
        {} as never
      )
    ).toBe('replayed');
    expect(
      replayFor(null, { paymentMethod: 'store_credit' }, {} as never)
    ).toBeNull();
  });
});
