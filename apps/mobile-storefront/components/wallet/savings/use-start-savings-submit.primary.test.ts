import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { useStartSavingsSubmit } from './use-start-savings-submit';
import { createInput } from './use-start-savings-submit.test-utils';

const mockAddSavingsContribution =
  jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockAddPrimaryContribution =
  jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockCheckStatus = jest.fn<(...args: unknown[]) => Promise<unknown>>();
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
    mockCheckStatus.mockResolvedValue({
      status: 'pending',
      operationId: 'stored-op',
    });
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

  it('opens the PIN sheet when a PIN is required, then retries the same id with the proof', async () => {
    const proof = createHash('sha256').update('s5m-hook-proof').digest('hex');
    mockAddPrimaryContribution
      .mockRejectedValueOnce(
        Object.assign(new Error('Please confirm your PIN to continue.'), {
          code: 'PIN_PROOF_REQUIRED',
        })
      )
      .mockResolvedValueOnce({ status: 'confirmed', operationId: 'op-uuid-1' });
    const input = readyInput();
    const { result } = renderHook(() => useStartSavingsSubmit(input));
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.submitBankTransferContribution();
    });
    await waitFor(() =>
      expect(result.current.pinSheetProps.request).toMatchObject({
        goalId: 'goal-1',
        amountKobo: 2000000,
      })
    );
    expect(Alert.alert).not.toHaveBeenCalled();
    act(() => result.current.pinSheetProps.onProof(proof));
    await act(async () => {
      await pending;
    });
    expect(mockAddPrimaryContribution).toHaveBeenCalledTimes(2);
    expect(mockAddPrimaryContribution).toHaveBeenLastCalledWith(
      expect.objectContaining({ pinProof: proof })
    );
    expect(mockAddSavingsContribution).not.toHaveBeenCalled();
    expect(input.setShowSuccessModal).toHaveBeenCalledWith(true);
  });

  it('keeps the id and says the goal was created when the PIN sheet is closed', async () => {
    mockAddPrimaryContribution.mockRejectedValue(
      Object.assign(new Error('Please confirm your PIN to continue.'), {
        code: 'PIN_PROOF_REQUIRED',
      })
    );
    const input = readyInput();
    const { result } = renderHook(() => useStartSavingsSubmit(input));
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.submitBankTransferContribution();
    });
    await waitFor(() =>
      expect(result.current.pinSheetProps.request).not.toBeNull()
    );
    act(() => result.current.pinSheetProps.onCancel());
    await act(async () => {
      await pending;
    });
    expect(mockAddPrimaryContribution).toHaveBeenCalledTimes(1);
    expect(mockAddSavingsContribution).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith(
      'Goal created',
      "Your goal was created. Add money to it from your wallet when you're ready."
    );
    expect(input.setInitialContributionIdempotencyKey).not.toHaveBeenCalledWith(
      null
    );
    expect(input.setShowSuccessModal).not.toHaveBeenCalled();
  });
});
