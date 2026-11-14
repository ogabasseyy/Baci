import { describe, expect, it, vi } from 'vitest';
import { refuseUnavailableWalletPayStart } from './vtu-wallet-pay-fulfiller';

vi.mock('server-only', () => ({}));
vi.mock('./run-vtu-wallet-pay-step', () => ({ runVtuWalletPayStep: vi.fn() }));
vi.mock('./vtu-wallet-pay-step-deps', () => ({
  createVtuWalletPayStepDeps: vi.fn(),
}));
vi.mock('@/lib/vtu-fulfillment', () => ({
  fulfillPendingVtuTransaction: vi.fn(),
}));

const runtime = { merchantId: 'merchant-1' } as never;
const piggyvest = { paymentMethod: 'piggyvest_wallet' } as never;

describe('bugfix: a start refused after its row was prepared stranded the purchase (Codex P2)', () => {
  it('refuses a PiggyVest start before preparation while wallet pay is off', async () => {
    const refused = refuseUnavailableWalletPayStart(piggyvest, () => null);
    expect(refused?.status).toBe(503);
    await expect(refused?.json()).resolves.toMatchObject({
      code: 'PIGGYVEST_PAY_UNAVAILABLE',
    });
  });

  it('refuses when the runtime is misconfigured (throws)', () => {
    const refused = refuseUnavailableWalletPayStart(piggyvest, () => {
      throw new Error('missing');
    });
    expect(refused?.status).toBe(503);
  });

  it('lets switched-on starts, re-checks and store credit through', () => {
    expect(
      refuseUnavailableWalletPayStart(piggyvest, () => runtime)
    ).toBeNull();
    expect(
      refuseUnavailableWalletPayStart(
        {
          paymentMethod: 'piggyvest_wallet',
          walletPayOperationId: '11111111-1111-4111-8111-111111111111',
        } as never,
        () => null
      )
    ).toBeNull();
    expect(
      refuseUnavailableWalletPayStart(
        { paymentMethod: 'store_credit' } as never,
        () => null
      )
    ).toBeNull();
  });
});
