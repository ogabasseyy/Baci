import { act, renderHook } from '@testing-library/react-native';
import { setupExistingSavingsGoal } from '@/lib/customer-savings';
import { useStartSavingsPrimarySetup } from './use-start-savings-primary-setup';

jest.mock('@/lib/is-piggyvest-primary-merchant', () => ({
  isPiggyvestPrimaryMerchant: (id?: string) => id === 'pv-merchant',
}));
jest.mock('@/lib/customer-savings', () => ({
  setupExistingSavingsGoal: jest.fn(() =>
    Promise.resolve({ status: 'pending' })
  ),
}));

describe('useStartSavingsPrimarySetup with PiggyVest off', () => {
  it('keeps auto debit, asks no interest question and starts no setup', () => {
    const { result } = renderHook(() =>
      useStartSavingsPrimarySetup({
        activeMerchantId: 'm',
        primaryWallet: false,
        wallet: { balance: 0, loyalty_points: 0 },
      })
    );
    expect(result.current.allowAutoDebit).toBe(true);
    expect(result.current.askInterest).toBe(false);
    expect(result.current.startGoalWalletSetup).toBeUndefined();
  });
});

describe('useStartSavingsPrimarySetup for a PiggyVest wallet', () => {
  it('starts the plan wallet setup with the interest answer from the form', async () => {
    const { result } = renderHook(() =>
      useStartSavingsPrimarySetup({
        activeMerchantId: 'm',
        primaryWallet: true,
      })
    );
    expect(result.current.allowAutoDebit).toBe(false);
    expect(result.current.startGoalWalletSetup).toBeUndefined();
    act(() => result.current.setInterestChoice(true));
    await result.current.startGoalWalletSetup?.('goal-1');
    expect(setupExistingSavingsGoal).toHaveBeenCalledWith({
      goalId: 'goal-1',
      merchantId: 'm',
      interestAccepted: true,
    });
  });
});

describe('bugfix: auto debit was offered before the wallet type was known', () => {
  it('hides auto debit while the wallet is loading or unavailable', () => {
    const loading = renderHook(() =>
      useStartSavingsPrimarySetup({
        activeMerchantId: 'm',
        primaryWallet: false,
      })
    );
    expect(loading.result.current.allowAutoDebit).toBe(false);
    const unavailable = renderHook(() =>
      useStartSavingsPrimarySetup({
        activeMerchantId: 'm',
        primaryWallet: false,
        wallet: { balance: 0, loyalty_points: 0, primary_unavailable: true },
      })
    );
    expect(unavailable.result.current.allowAutoDebit).toBe(false);
  });

  it('treats a PiggyVest merchant as PiggyVest even before the balance reads', () => {
    const { result } = renderHook(() =>
      useStartSavingsPrimarySetup({
        activeMerchantId: 'pv-merchant',
        primaryWallet: false,
        wallet: { balance: 0, loyalty_points: 0 },
      })
    );
    expect(result.current.allowAutoDebit).toBe(false);
    expect(result.current.askInterest).toBe(true);
  });
});

describe('bugfix: the interest answer carried over to another account', () => {
  it('clears the answer when the signed-in account changes', () => {
    const { result, rerender } = renderHook(
      ({ userId }: { userId: string }) =>
        useStartSavingsPrimarySetup({
          activeMerchantId: 'm',
          primaryWallet: true,
          userId,
        }),
      { initialProps: { userId: 'user-a' } }
    );
    act(() => result.current.setInterestChoice(true));
    expect(result.current.interestChoice).toBe(true);
    rerender({ userId: 'user-b' });
    expect(result.current.interestChoice).toBeNull();
    expect(result.current.startGoalWalletSetup).toBeUndefined();
  });
});
