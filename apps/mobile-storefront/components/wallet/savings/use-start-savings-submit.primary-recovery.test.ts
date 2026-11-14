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
let mockUuidCount = 0;
jest.mock('expo-crypto', () => ({
  randomUUID: () => `op-uuid-${++mockUuidCount}`,
}));
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
  mockIsPrimary.mockReturnValue(true);
  const input = readyInput(overrides);
  const { result } = renderHook(() => useStartSavingsSubmit(input));
  await act(async () => {
    await result.current.submitBankTransferContribution();
  });
  return input;
};

type SubmitInput = Parameters<typeof useStartSavingsSubmit>[0];
type Rail = 'primary' | 'legacy';
type RailAttempt = { onRail?: (rail: Rail) => void };

/** First attempt mints op-uuid-1 and loses its response; the rail it used sticks. */
const lostFirstAttempt = async (rail: Rail) => {
  mockIsPrimary.mockReturnValue(rail === 'primary');
  const lost = new Error('timeout');
  if (rail === 'primary') {
    mockAddPrimaryContribution.mockImplementationOnce(async (arg) => {
      (arg as RailAttempt).onRail?.('primary');
      throw lost;
    });
  } else {
    mockAddSavingsContribution.mockRejectedValueOnce(lost);
  }
  // Stands in for the controller state that persists the rail with the key.
  let persisted: Rail | null = null;
  const first = readyInput({
    setInitialContributionRail: (_id: string, used: Rail) => {
      persisted = used;
    },
  });
  const hook = renderHook(
    ({ value }: { value: SubmitInput }) => useStartSavingsSubmit(value),
    {
      initialProps: { value: first },
    }
  );
  await act(async () => {
    await hook.result.current.submitBankTransferContribution();
  });
  expect(first.setInitialContributionIdempotencyKey).toHaveBeenCalledWith(
    'op-uuid-1'
  );
  jest.clearAllMocks();
  return {
    hook,
    retry: readyInput({
      initialContributionIdempotencyKey: 'op-uuid-1',
      initialContributionRail: persisted,
      setInitialContributionRail: jest.fn(),
    }),
  };
};

const retryWith = async (rail: Rail, mode: Rail, overrides = {}) => {
  const { hook, retry } = await lostFirstAttempt(rail);
  mockIsPrimary.mockReturnValue(mode === 'primary');
  const input = { ...retry, ...overrides };
  hook.rerender({ value: input });
  await act(async () => {
    await hook.result.current.submitBankTransferContribution();
  });
  return input;
};

describe('submitBankTransferContribution stored operation recovery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUuidCount = 0;
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockCheckStatus.mockResolvedValue({
      status: 'pending',
      operationId: 'op-uuid-1',
    });
    mockAddPrimaryContribution.mockResolvedValue({
      status: 'confirmed',
      operationId: 'op-uuid-1',
    });
    mockAddSavingsContribution.mockResolvedValue({
      goalStatus: 'active',
      success: true,
    });
  });

  it('checks a primary-rail operation, then resubmits it on primary', async () => {
    await retryWith('primary', 'primary');
    expect(mockCheckStatus).toHaveBeenCalledWith({
      merchantId: 'merchant-1',
      operationId: 'op-uuid-1',
    });
    expect(mockAddPrimaryContribution).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'op-uuid-1' })
    );
    expect(mockAddSavingsContribution).not.toHaveBeenCalled();
  });

  it('starts a fresh operation when the primary one was cancelled', async () => {
    mockCheckStatus.mockResolvedValue({
      status: 'cancelled',
      operationId: 'op-uuid-1',
    });
    const input = await retryWith('primary', 'primary');
    expect(input.setInitialContributionIdempotencyKey).toHaveBeenCalledWith(
      'op-uuid-2'
    );
    expect(mockAddPrimaryContribution).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'op-uuid-2' })
    );
  });

  it('releases the id and mints a fresh one on primary CONTRIBUTION_NOT_FOUND', async () => {
    mockCheckStatus.mockRejectedValue(
      Object.assign(new Error('nf'), { code: 'CONTRIBUTION_NOT_FOUND' })
    );
    const input = await retryWith('primary', 'primary');
    expect(input.setInitialContributionIdempotencyKey).toHaveBeenCalledWith(
      'op-uuid-2'
    );
    expect(mockAddPrimaryContribution).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'op-uuid-2' })
    );
  });

  it('blocks resubmission when the primary status check is ambiguous', async () => {
    mockCheckStatus.mockRejectedValue(new Error('network'));
    const input = await retryWith('primary', 'primary');
    expect(mockAddPrimaryContribution).not.toHaveBeenCalled();
    expect(mockAddSavingsContribution).not.toHaveBeenCalled();
    expect(input.setShowSuccessModal).not.toHaveBeenCalled();
    expect(input.setInitialContributionIdempotencyKey).not.toHaveBeenCalled();
    expect(input.setFormError).toHaveBeenCalledWith(
      expect.stringContaining('Could not confirm')
    );
  });

  it('completes a confirmed primary operation without submitting it again', async () => {
    mockCheckStatus.mockResolvedValue({
      status: 'confirmed',
      operationId: 'op-uuid-1',
    });
    const input = await retryWith('primary', 'primary');
    expect(mockAddPrimaryContribution).not.toHaveBeenCalled();
    expect(mockAddSavingsContribution).not.toHaveBeenCalled();
    expect(input.setShowSuccessModal).toHaveBeenCalledWith(true);
    expect(input.setInitialContributionIdempotencyKey).toHaveBeenCalledWith(
      null
    );
  });

  it('keeps a legacy-rail operation on legacy even after primary is enabled', async () => {
    const input = await retryWith('legacy', 'primary');
    expect(mockCheckStatus).not.toHaveBeenCalled();
    expect(mockAddPrimaryContribution).not.toHaveBeenCalled();
    expect(mockAddSavingsContribution).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'op-uuid-1' })
    );
    expect(input.setShowSuccessModal).toHaveBeenCalledWith(true);
  });

  it('keeps the legacy rail when the primary helper fell back to legacy', async () => {
    mockIsPrimary.mockReturnValue(true);
    mockAddPrimaryContribution.mockImplementationOnce(async (arg) => {
      (arg as RailAttempt).onRail?.('primary');
      (arg as RailAttempt).onRail?.('legacy');
      throw new Error('timeout');
    });
    let persisted: Rail | null = null;
    const first = readyInput({
      setInitialContributionRail: (_id: string, used: Rail) => {
        persisted = used;
      },
    });
    const hook = renderHook(
      ({ value }: { value: SubmitInput }) => useStartSavingsSubmit(value),
      {
        initialProps: { value: first },
      }
    );
    await act(async () => {
      await hook.result.current.submitBankTransferContribution();
    });
    jest.clearAllMocks();
    hook.rerender({
      value: readyInput({
        initialContributionIdempotencyKey: 'op-uuid-1',
        initialContributionRail: persisted,
        setInitialContributionRail: jest.fn(),
      }),
    });
    await act(async () => {
      await hook.result.current.submitBankTransferContribution();
    });
    expect(mockCheckStatus).not.toHaveBeenCalled();
    expect(mockAddPrimaryContribution).not.toHaveBeenCalled();
    expect(mockAddSavingsContribution).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'op-uuid-1' })
    );
  });

  it('never moves a pending primary operation to legacy when primary is off', async () => {
    const input = await retryWith('primary', 'legacy');
    expect(mockAddPrimaryContribution).not.toHaveBeenCalled();
    expect(mockAddSavingsContribution).not.toHaveBeenCalled();
    expect(input.setInitialContributionIdempotencyKey).not.toHaveBeenCalled();
    expect(input.setFormError).toHaveBeenCalledWith(
      expect.stringContaining('checking your earlier contribution')
    );
  });

  it('does not check status for legacy customers', async () => {
    await retryWith('legacy', 'legacy');
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
