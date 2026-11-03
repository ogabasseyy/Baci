import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { useStartSavingsSubmit } from './use-start-savings-submit';
import { createInput } from './use-start-savings-submit.test-utils';

const mockAddSavingsContribution =
  jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockAddPrimaryContribution =
  jest.fn<(...args: unknown[]) => Promise<unknown>>();
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
jest.mock('@/lib/is-piggyvest-primary-merchant', () => ({
  isPiggyvestPrimaryMerchant: (merchantId?: string | null) =>
    mockIsPrimary(merchantId),
}));
jest.mock('@/lib/clipboard', () => ({ setClipboardString: jest.fn() }));
jest.mock('@/services/savings-reminder-notifications', () => ({
  cancelSavingsReminderNotification: jest.fn(async () => true),
  scheduleSavingsReminderNotification: jest.fn(async () => 'reminder-1'),
}));

const readyInput = (overrides = {}) =>
  createInput({
    createdGoalId: 'goal-1',
    effectiveInitialContribution: 20000,
    ...overrides,
  });

describe('submitBankTransferContribution primary routing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockIsPrimary.mockReturnValue(true);
  });

  it('never calls the legacy contribution for a primary customer', async () => {
    mockAddPrimaryContribution.mockResolvedValue({
      status: 'confirmed',
      operationId: 'op-uuid-1',
    });
    const input = readyInput();
    const { result } = renderHook(() => useStartSavingsSubmit(input));
    await act(async () => {
      await result.current.submitBankTransferContribution();
    });
    expect(mockAddSavingsContribution).not.toHaveBeenCalled();
    expect(mockAddPrimaryContribution).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 20000,
        goalId: 'goal-1',
        idempotencyKey: 'op-uuid-1',
        merchantId: 'merchant-1',
      })
    );
    expect(input.setShowSuccessModal).toHaveBeenCalledWith(true);
  });

  it('reuses the stored operation id on retry', async () => {
    mockAddPrimaryContribution.mockResolvedValue({
      status: 'confirmed',
      operationId: 'stored-op',
    });
    const input = readyInput({
      initialContributionIdempotencyKey: 'stored-op',
    });
    const { result } = renderHook(() => useStartSavingsSubmit(input));
    await act(async () => {
      await result.current.submitBankTransferContribution();
    });
    expect(mockAddPrimaryContribution).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'stored-op' })
    );
  });

  it('shows pending, keeps the operation and never reports success', async () => {
    mockAddPrimaryContribution.mockResolvedValue({
      status: 'pending',
      operationId: 'op-uuid-1',
    });
    const input = readyInput();
    const { result } = renderHook(() => useStartSavingsSubmit(input));
    await act(async () => {
      await result.current.submitBankTransferContribution();
    });
    expect(Alert.alert).toHaveBeenCalledWith(
      'Transfer pending',
      expect.any(String)
    );
    expect(input.refetch).toHaveBeenCalled();
    expect(input.setShowSuccessModal).not.toHaveBeenCalled();
    expect(input.setInitialContributionIdempotencyKey).not.toHaveBeenCalledWith(
      null
    );
  });

  it('releases the operation on a cancelled transfer without success', async () => {
    mockAddPrimaryContribution.mockResolvedValue({
      status: 'cancelled',
      operationId: 'op-uuid-1',
    });
    const input = readyInput();
    const { result } = renderHook(() => useStartSavingsSubmit(input));
    await act(async () => {
      await result.current.submitBankTransferContribution();
    });
    expect(input.setInitialContributionIdempotencyKey).toHaveBeenCalledWith(
      null
    );
    expect(input.setShowSuccessModal).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith(
      'Transfer cancelled',
      expect.any(String)
    );
  });

  it('accepts the legacy fallback result the primary helper may return', async () => {
    mockAddPrimaryContribution.mockResolvedValue({
      contributionId: 'c1',
      goalStatus: 'active',
      success: true,
    });
    const input = readyInput();
    const { result } = renderHook(() => useStartSavingsSubmit(input));
    await act(async () => {
      await result.current.submitBankTransferContribution();
    });
    expect(input.setShowSuccessModal).toHaveBeenCalledWith(true);
  });

  it('keeps legacy customers on the legacy contribution', async () => {
    mockIsPrimary.mockReturnValue(false);
    mockAddSavingsContribution.mockResolvedValue({
      goalStatus: 'active',
      success: true,
    });
    const input = readyInput();
    const { result } = renderHook(() => useStartSavingsSubmit(input));
    await act(async () => {
      await result.current.submitBankTransferContribution();
    });
    expect(mockAddPrimaryContribution).not.toHaveBeenCalled();
    expect(mockAddSavingsContribution).toHaveBeenCalledTimes(1);
    expect(input.setShowSuccessModal).toHaveBeenCalledWith(true);
  });
});
