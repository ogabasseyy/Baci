import { describe, expect, it, jest } from '@jest/globals';
import { Alert } from 'react-native';
import { handOffToWallet } from './hand-off-to-wallet';

// With PiggyVest off no head start is deferred, so a hand-off only ever sees
// a wallet without the plan and must fail safe: no wallet opened.
describe('wallet hand-off with the server off', () => {
  it('opens nothing when the wallet has no such plan', async () => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const onContinueInWallet = jest.fn();
    const onHandOffPending = jest.fn();
    await handOffToWallet(
      {
        effectiveInitialContribution: 5000,
        onContinueInWallet,
        onHandOffPending,
        refetch: async () => ({
          isError: false,
          data: { wallet: { balance: 0, savings_goals: [] } },
        }),
        setFormError: jest.fn(),
      },
      'goal-1',
      () => true
    );
    expect(onContinueInWallet).not.toHaveBeenCalled();
    expect(onHandOffPending).toHaveBeenCalledWith('goal-1');
  });
});
