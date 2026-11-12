import { act, renderHook } from '@testing-library/react-native';
import { setupExistingSavingsGoal } from '@/lib/customer-savings';
import { useStartSavingsPrimarySetup } from './use-start-savings-primary-setup';

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
