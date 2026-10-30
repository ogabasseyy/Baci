import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { observePiggyvestPrimaryCapability } from '@/lib/piggyvest-primary-capability-cache';
import { useStartSavingsSubmit } from './use-start-savings-submit';
import { createInput } from './use-start-savings-submit.test-utils';

const mockReplace = jest.fn();
const mockPush = jest.fn();
const mockAddContribution = jest.fn<() => Promise<never>>();

jest.mock('expo-router', () => ({
  router: {
    replace: (...args: unknown[]) => mockReplace(...args),
    push: (...args: unknown[]) => mockPush(...args),
  },
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'retained-key' }));
jest.mock('@/lib/customer-savings', () => ({
  addSavingsContribution: () => mockAddContribution(),
}));
jest.mock('@/lib/clipboard', () => ({ setClipboardString: jest.fn() }));
jest.mock('@/services/savings-reminder-notifications', () => ({
  cancelSavingsReminderNotification: jest.fn(),
}));

describe('new plan primary wallet handoff', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    observePiggyvestPrimaryCapability('primary-merchant', true);
    observePiggyvestPrimaryCapability('merchant-1', false);
    mockAddContribution.mockRejectedValue(
      new Error(
        'Invalid server response (502 bad gateway): JSON Parse error: Unexpected character: <'
      )
    );
  });

  it('opens the existing primary plan without calling the retired manual contribution endpoint', async () => {
    const input = createInput({
      activeMerchantId: 'primary-merchant',
      createdGoalId: 'created-goal',
      effectiveInitialContribution: 10000,
      fundingAccount: null,
    });
    const { result } = renderHook(() => useStartSavingsSubmit(input));

    await act(async () => result.current.submitBankTransferContribution());

    expect(mockAddContribution).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/wallet',
      params: {
        action: 'savings',
        savingsGoalId: 'created-goal',
        savingsAmount: '10000',
      },
    });
    expect(input.setShowSuccessModal).not.toHaveBeenCalledWith(true);
    expect(input.setInitialContributionIdempotencyKey).not.toHaveBeenCalled();
  });

  it('preserves the created goal and amount when opening primary wallet funding', () => {
    const input = createInput({
      activeMerchantId: 'primary-merchant',
      createdGoalId: 'created-goal',
      effectiveInitialContribution: 10000,
    });
    const { result } = renderHook(() => useStartSavingsSubmit(input));

    act(() => result.current.openWalletFundingScreen());

    expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/wallet',
      params: {
        action: 'bank-transfer',
        intent: 'retained-key',
        requiredAmount: '50000',
        returnTo:
          '/wallet?action=savings&savingsGoalId=created-goal&savingsAmount=10000',
      },
    });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('shows a safe status-check message rather than a raw gateway parse error', async () => {
    const input = createInput({ createdGoalId: 'legacy-goal' });
    const { result } = renderHook(() => useStartSavingsSubmit(input));

    await act(async () => result.current.submitBankTransferContribution());

    expect(mockAddContribution).toHaveBeenCalledTimes(1);
    expect(input.setFormError).toHaveBeenCalledWith(
      'We couldn’t confirm your contribution. Check your savings activity before trying again.'
    );
    expect(input.setShowSuccessModal).not.toHaveBeenCalledWith(true);
  });
});
