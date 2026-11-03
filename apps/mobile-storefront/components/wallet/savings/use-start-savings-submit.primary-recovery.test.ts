import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { useStartSavingsSubmit } from './use-start-savings-submit';
import { createInput } from './use-start-savings-submit.test-utils';

const mockAddSavingsContribution =
  jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockAddPrimaryContribution =
  jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockCheckStatus = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockCancelReminder = jest.fn<(goalId: string) => Promise<boolean>>();
const mockIsPrimary = jest.fn<(merchantId?: string | null) => boolean>();

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'op-uuid-1' }));
jest.mock('@/lib/customer-savings', () => ({
  addSavingsContribution: (...args: unknown[]) =>
    mockAddSavingsContribution(...args),
  createSavingsGoal: jest.fn(),
  initializeSavingsAuthorization: jest.fn(),
}));
jest.mock('@/lib/piggyvest-primary-savings', () => ({
  addPiggyvestPrimarySavingsContribution: (...args: unknown[]) =>
    mockAddPrimaryContribution(...args),
}));
jest.mock('@/lib/piggyvest-primary-savings-status', () => ({
  checkPiggyvestPrimarySavingsStatus: (...args: unknown[]) =>
    mockCheckStatus(...args),
}));
jest.mock('@/lib/is-piggyvest-primary-merchant', () => ({
  isPiggyvestPrimaryMerchant: (merchantId?: string | null) =>
    mockIsPrimary(merchantId),
}));
jest.mock('@/lib/clipboard', () => ({ setClipboardString: jest.fn() }));
jest.mock('@/services/savings-reminder-notifications', () => ({
  cancelSavingsReminderNotification: (goalId: string) =>
    mockCancelReminder(goalId),
  scheduleSavingsReminderNotification: jest.fn(async () => 'reminder-1'),
}));

const readyInput = (overrides = {}) =>
  createInput({
    createdGoalId: 'goal-1',
    effectiveInitialContribution: 20000,
    ...overrides,
  });

const submitWith = async (overrides = {}) => {
  const input = readyInput({
    initialContributionIdempotencyKey: 'stored-op',
    ...overrides,
  });
  const { result } = renderHook(() => useStartSavingsSubmit(input));
  await act(async () => {
    await result.current.submitBankTransferContribution();
  });
  return input;
};

describe('submitBankTransferContribution stored operation recovery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockIsPrimary.mockReturnValue(true);
    mockCheckStatus.mockResolvedValue({
      status: 'pending',
      operationId: 'stored-op',
    });
    mockAddPrimaryContribution.mockResolvedValue({
      status: 'confirmed',
      operationId: 'op-uuid-1',
    });
  });

  it('checks the stored operation before resubmitting it', async () => {
    await submitWith();
    expect(mockCheckStatus).toHaveBeenCalledWith({
      merchantId: 'merchant-1',
      operationId: 'stored-op',
    });
    expect(mockAddPrimaryContribution).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'stored-op' })
    );
  });

  it('starts a fresh operation when the stored one was cancelled', async () => {
    mockCheckStatus.mockResolvedValue({
      status: 'cancelled',
      operationId: 'stored-op',
    });
    const input = await submitWith();
    expect(input.setInitialContributionIdempotencyKey).toHaveBeenCalledWith(
      'op-uuid-1'
    );
    expect(mockAddPrimaryContribution).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'op-uuid-1' })
    );
  });

  it('keeps the stored id when primary has no record, since the legacy rail may hold it', async () => {
    mockCheckStatus.mockRejectedValue(
      Object.assign(new Error('nf'), { code: 'CONTRIBUTION_NOT_FOUND' })
    );
    await submitWith();
    expect(mockAddPrimaryContribution).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'stored-op' })
    );
  });

  it('keeps the stored operation when the status check is ambiguous', async () => {
    mockCheckStatus.mockRejectedValue(new Error('network'));
    await submitWith();
    expect(mockAddPrimaryContribution).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'stored-op' })
    );
  });

  it('completes a confirmed stored operation without submitting it again', async () => {
    mockCheckStatus.mockResolvedValue({
      status: 'confirmed',
      operationId: 'stored-op',
    });
    const input = await submitWith();
    expect(mockAddPrimaryContribution).not.toHaveBeenCalled();
    expect(mockAddSavingsContribution).not.toHaveBeenCalled();
    expect(input.setShowSuccessModal).toHaveBeenCalledWith(true);
    expect(input.setInitialContributionIdempotencyKey).toHaveBeenCalledWith(
      null
    );
  });

  it('does not check status for legacy customers', async () => {
    mockIsPrimary.mockReturnValue(false);
    mockAddSavingsContribution.mockResolvedValue({
      goalStatus: 'active',
      success: true,
    });
    await submitWith();
    expect(mockCheckStatus).not.toHaveBeenCalled();
  });

  it('releases the operation on WALLET_UNAVAILABLE so a retry can start fresh', async () => {
    mockAddPrimaryContribution.mockRejectedValue(
      Object.assign(new Error('Wallet unavailable'), {
        code: 'WALLET_UNAVAILABLE',
      })
    );
    const input = await submitWith({ initialContributionIdempotencyKey: null });
    expect(input.setInitialContributionIdempotencyKey).toHaveBeenLastCalledWith(
      null
    );
  });

  it('cancels the retained reminder when a confirmed primary transfer covers the target', async () => {
    const input = await submitWith({
      effectiveInitialContribution: 800000,
      targetValue: 800000,
    });
    expect(input.setShowSuccessModal).toHaveBeenCalledWith(true);
    expect(mockCancelReminder).toHaveBeenCalledWith('goal-1');
  });

  it('keeps the reminder when a confirmed primary transfer does not cover the target', async () => {
    await submitWith();
    expect(mockCancelReminder).not.toHaveBeenCalled();
  });
});
