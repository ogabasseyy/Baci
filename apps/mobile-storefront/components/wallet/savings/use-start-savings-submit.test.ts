import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { useStartSavingsSubmit } from './use-start-savings-submit';
import { createInput } from './use-start-savings-submit.test-utils';

const mockRouterPush = jest.fn();
const mockRouterReplace = jest.fn();
const mockCreateSavingsGoal =
  jest.fn<
    (...args: unknown[]) => Promise<{ goalId: string; success: boolean }>
  >();
const mockInitializeSavingsAuthorization =
  jest.fn<
    (...args: unknown[]) => Promise<{
      authorization_url: string;
      gateway: 'paystack';
      reference: string;
      success: true;
    }>
  >();
const mockSetClipboardString =
  jest.fn<(...args: unknown[]) => Promise<boolean>>();
const mockRandomUUID = jest.fn();
const mockScheduleSavingsReminderNotification =
  jest.fn<(...args: unknown[]) => Promise<string | null>>();
const mockCancelSavingsReminderNotification =
  jest.fn<(...args: unknown[]) => Promise<boolean>>();

jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockRouterPush(...args),
    replace: (...args: unknown[]) => mockRouterReplace(...args),
  },
}));

jest.mock('expo-crypto', () => ({
  randomUUID: () => mockRandomUUID(),
}));

jest.mock('@/lib/customer-savings', () => ({
  createSavingsGoal: (...args: unknown[]) => mockCreateSavingsGoal(...args),
  initializeSavingsAuthorization: (...args: unknown[]) =>
    mockInitializeSavingsAuthorization(...args),
}));

jest.mock('@/lib/clipboard', () => ({
  setClipboardString: (...args: unknown[]) => mockSetClipboardString(...args),
}));

jest.mock('@/services/savings-reminder-notifications', () => ({
  cancelSavingsReminderNotification: (...args: unknown[]) =>
    mockCancelSavingsReminderNotification(...args),
  scheduleSavingsReminderNotification: (...args: unknown[]) =>
    mockScheduleSavingsReminderNotification(...args),
}));

describe('useStartSavingsSubmit', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockRandomUUID.mockReturnValue('initial-key-1');
    mockCreateSavingsGoal.mockResolvedValue({
      goalId: 'goal-1',
      success: true,
    });
    mockInitializeSavingsAuthorization.mockResolvedValue({
      authorization_url: 'https://checkout.paystack.com/auth',
      gateway: 'paystack',
      reference: 'AUTH-1',
      success: true,
    });
    mockSetClipboardString.mockResolvedValue(true);
    mockCancelSavingsReminderNotification.mockResolvedValue(true);
    mockScheduleSavingsReminderNotification.mockResolvedValue('reminder-1');
  });

  it('submits a manual savings goal and reuses one idempotency key', async () => {
    const input = createInput();
    const { result } = renderHook(() => useStartSavingsSubmit(input));

    await act(async () => {
      await result.current.submitSavingsGoal();
    });

    expect(input.setInitialContributionIdempotencyKey).toHaveBeenCalledWith(
      'initial-key-1'
    );
    expect(mockCreateSavingsGoal).toHaveBeenCalledWith(
      expect.objectContaining({
        initialContributionIdempotencyKey: 'initial-key-1',
        productId: 'product-1',
        sourceMode: 'manual',
      })
    );
    expect(mockScheduleSavingsReminderNotification).toHaveBeenCalledWith({
      contributionAmount: 20000,
      frequency: 'daily',
      goalId: 'goal-1',
      goalTitle: 'iPhone 13 Pro Max',
      scheduledAt: new Date('2026-05-22T06:20:00'),
    });
    expect(mockCancelSavingsReminderNotification).not.toHaveBeenCalled();
    expect(input.setShowSuccessModal).toHaveBeenCalledWith(true);
  });

  it('skips recurring reminders when the initial contribution completes the goal', async () => {
    const input = createInput({
      effectiveInitialContribution: 800000,
      targetValue: 800000,
    });
    const { result } = renderHook(() => useStartSavingsSubmit(input));

    await act(async () => {
      await result.current.submitSavingsGoal();
    });

    expect(mockCreateSavingsGoal).toHaveBeenCalledWith(
      expect.objectContaining({
        initialContributionAmount: 800000,
        targetAmount: 800000,
      })
    );
    expect(mockScheduleSavingsReminderNotification).not.toHaveBeenCalled();
    expect(mockCancelSavingsReminderNotification).toHaveBeenCalledWith(
      'goal-1'
    );
    expect(input.setShowSuccessModal).toHaveBeenCalledWith(true);
  });

  it('does not block manual goal creation when reminder scheduling fails', async () => {
    mockScheduleSavingsReminderNotification.mockRejectedValue(
      new Error('notifications denied')
    );
    const input = createInput();
    const { result } = renderHook(() => useStartSavingsSubmit(input));

    await act(async () => {
      await result.current.submitSavingsGoal();
    });

    expect(input.setShowSuccessModal).toHaveBeenCalledWith(true);
    expect(input.setFormError).not.toHaveBeenCalledWith('notifications denied');
  });

  it('ignores duplicate savings submissions while the first request is in flight', async () => {
    let resolveCreate:
      | ((value: { goalId: string; success: boolean }) => void)
      | undefined;
    mockCreateSavingsGoal.mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve;
      })
    );
    const input = createInput();
    const { result } = renderHook(() => useStartSavingsSubmit(input));

    let firstSubmit: Promise<void> = Promise.resolve();
    let duplicateSubmit: Promise<void> = Promise.resolve();
    act(() => {
      firstSubmit = result.current.submitSavingsGoal();
      duplicateSubmit = result.current.submitSavingsGoal();
    });

    expect(mockCreateSavingsGoal).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveCreate?.({ goalId: 'goal-1', success: true });
      await firstSubmit;
      await duplicateSubmit;
    });

    expect(input.setShowSuccessModal).toHaveBeenCalledTimes(1);
  });

  it('surfaces an error when savings goal creation returns success false', async () => {
    mockCreateSavingsGoal.mockResolvedValue({
      goalId: 'goal-1',
      success: false,
    });
    const input = createInput();
    const { result } = renderHook(() => useStartSavingsSubmit(input));

    await act(async () => {
      await result.current.submitSavingsGoal();
    });

    expect(input.setInitialContributionIdempotencyKey).toHaveBeenCalledWith(
      'initial-key-1'
    );
    expect(mockCreateSavingsGoal).toHaveBeenCalledWith(
      expect.objectContaining({ productId: 'product-1' })
    );
    expect(input.setFormError).toHaveBeenCalledWith(
      'Unable to create savings plan.'
    );
    expect(Alert.alert).toHaveBeenCalledWith(
      'Unable to create plan',
      'Unable to create savings plan.'
    );
    expect(input.setShowSuccessModal).not.toHaveBeenCalled();
  });

  it('keeps success visible when wallet data refresh fails after creation', async () => {
    const input = createInput({
      refetch: jest.fn(() => Promise.reject(new Error('Refresh failed'))),
    });
    const { result } = renderHook(() => useStartSavingsSubmit(input));

    await act(async () => {
      await result.current.submitSavingsGoal();
    });

    expect(input.setShowSuccessModal).toHaveBeenCalledWith(true);
    expect(input.setFormError).toHaveBeenLastCalledWith(
      'Plan created but unable to refresh wallet data.'
    );
    expect(Alert.alert).not.toHaveBeenCalledWith(
      'Unable to create plan',
      expect.any(String)
    );
  });

  it('requires a selected card before submitting auto-debit savings', async () => {
    const input = createInput({ sourceMode: 'auto_debit' });
    const { result } = renderHook(() => useStartSavingsSubmit(input));

    await act(async () => {
      await result.current.submitSavingsGoal();
    });

    expect(input.setFormError).toHaveBeenCalledWith(
      'Select a saved card for auto debit.'
    );
    expect(mockCreateSavingsGoal).not.toHaveBeenCalled();
    expect(mockScheduleSavingsReminderNotification).not.toHaveBeenCalled();
    expect(mockCancelSavingsReminderNotification).not.toHaveBeenCalled();
  });

  it('fails visibly when the start date cannot be formatted', async () => {
    const input = createInput({ startDate: 'not-a-date' });
    const { result } = renderHook(() => useStartSavingsSubmit(input));

    await act(async () => {
      await result.current.submitSavingsGoal();
    });

    expect(input.setFormError).toHaveBeenCalledWith(
      'Select a valid start date.'
    );
    expect(mockCreateSavingsGoal).not.toHaveBeenCalled();
  });

  it('opens the transfer modal for insufficient wallet balance', async () => {
    const error = Object.assign(new Error('Insufficient wallet balance'), {
      code: 'INSUFFICIENT_WALLET_BALANCE',
    });
    mockCreateSavingsGoal.mockRejectedValue(error);
    const input = createInput();
    const { result } = renderHook(() => useStartSavingsSubmit(input));

    await act(async () => {
      await result.current.submitSavingsGoal();
    });

    expect(input.setShowTransferModal).toHaveBeenCalledWith(true);
    expect(Alert.alert).not.toHaveBeenCalledWith(
      'Unable to create plan',
      expect.any(String)
    );
  });

  it('surfaces generic savings goal API failures', async () => {
    mockCreateSavingsGoal.mockRejectedValue(new Error('API unavailable'));
    const input = createInput();
    const { result } = renderHook(() => useStartSavingsSubmit(input));

    await act(async () => {
      await result.current.submitSavingsGoal();
    });

    expect(input.setFormError).toHaveBeenCalledWith('API unavailable');
    expect(Alert.alert).toHaveBeenCalledWith(
      'Unable to create plan',
      'API unavailable'
    );
  });
});
