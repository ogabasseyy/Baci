import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { Alert } from 'react-native';
import { formatNgnCurrency } from './format-ngn-currency';
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

  it('bugfix: formats fractional and large naira like the rest of the app', () => {
    // Arrange: koboToNaira can leave a fractional store credit balance.
    promptPiggyvestUtilityShortfall({
      amount: 12_500,
      balance: 369.5,
      refetchWallet: () => {},
      verdict: { walletIsStoreCredit: true },
    });

    // Assert: shared NGN formatter, never the device-locale toLocaleString.
    const call = (Alert.alert as unknown as jest.Mock).mock.calls[0];
    expect(call[1]).toContain(formatNgnCurrency(12_500));
    expect(call[1]).toContain(formatNgnCurrency(369.5));
    expect(call[1]).toContain('₦369.50');
    expect(call[1]).toContain(`add ${formatNgnCurrency(12_131)} store credit`);
  });
});
