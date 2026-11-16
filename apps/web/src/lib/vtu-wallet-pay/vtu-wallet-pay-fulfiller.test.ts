import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createVtuWalletPayFulfiller } from './vtu-wallet-pay-fulfiller';

vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ step: vi.fn(), fulfil: vi.fn() }));
vi.mock('./run-vtu-wallet-pay-step', () => ({
  runVtuWalletPayStep: mocks.step,
}));
vi.mock('./vtu-wallet-pay-step-deps', () => ({
  createVtuWalletPayStepDeps: () => 'deps',
}));

const auth = { supabase: {} as never, user: {} as never };

beforeEach(() => vi.resetAllMocks());

describe('createVtuWalletPayFulfiller', () => {
  it('is absent for store credit, so those paths stay unchanged', () => {
    expect(
      createVtuWalletPayFulfiller({
        charge: { paymentMethod: 'store_credit' } as never,
        auth,
        fulfil: mocks.fulfil,
      })
    ).toBeNull();
  });

  it('runs the PiggyVest step for the purchase, vending only through the claimed fulfil', async () => {
    const make = createVtuWalletPayFulfiller({
      charge: {
        paymentMethod: 'piggyvest_wallet',
        walletPayOperationId: 'op',
        walletPayPinProof: 'proof',
      } as never,
      auth,
      fulfil: mocks.fulfil,
    });
    mocks.step.mockResolvedValue('response');
    await expect(make?.('merchant-1', 'customer-1')('txn-1')).resolves.toBe(
      'response'
    );
    const [input, deps] = mocks.step.mock.calls[0];
    expect(input).toMatchObject({
      transactionId: 'txn-1',
      merchantId: 'merchant-1',
      customerId: 'customer-1',
      operationId: 'op',
      pinProof: 'proof',
    });
    expect(deps).toBe('deps');
    await input.fulfil(true);
    // The route's injected fulfil gets the purchase and the claim flag.
    expect(mocks.fulfil).toHaveBeenCalledWith('txn-1', true);
  });
});
