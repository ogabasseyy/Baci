import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { Alert } from 'react-native';
import { promptPiggyvestUtilityShortfall } from './prompt-piggyvest-utility-shortfall';

// With the server keeping PiggyVest off neither verdict is set, so the
// helper stays out of the way and today's funding prompt runs.
describe('promptPiggyvestUtilityShortfall (server off)', () => {
  beforeEach(() => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does nothing without a PiggyVest verdict', () => {
    expect(
      promptPiggyvestUtilityShortfall({
        amount: 1000,
        balance: 200,
        refetchWallet: () => {},
        verdict: {},
      })
    ).toBe(false);
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('explains the shortfall without a funding button when no return link', () => {
    expect(
      promptPiggyvestUtilityShortfall({
        amount: 1000,
        balance: 200,
        refetchWallet: () => {},
        verdict: { walletIsStoreCredit: true },
      })
    ).toBe(true);
    const call = (Alert.alert as unknown as jest.Mock).mock.calls[0];
    expect(call[0]).toBe('Not enough store credit');
    expect(call[1]).toContain('₦800');
    expect(call[2]).toEqual([{ text: 'OK', style: 'cancel' }]);
  });

  it('quotes the card minimum when the shortfall is below it', () => {
    promptPiggyvestUtilityShortfall({
      amount: 250,
      balance: 200,
      refetchWallet: () => {},
      verdict: { walletIsStoreCredit: true },
    });
    const call = (Alert.alert as unknown as jest.Mock).mock.calls[0];
    expect(call[1]).toContain('add ₦100 store credit by card');
  });
});
