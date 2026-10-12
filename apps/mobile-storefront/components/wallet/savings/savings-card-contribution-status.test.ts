import { getSavingsCardContributionStatus } from '@/lib/savings-card-contributions';
import {
  readSavingsCardContributionStatus,
  syncSavingsCardContributionStatus,
} from './savings-card-contribution-status';

jest.mock('@/lib/savings-card-contributions', () => ({
  getSavingsCardContributionStatus: jest.fn(),
}));

const snapshot = {
  goalId: 'goal-1',
  savedMethodId: 'method-1',
  amountKobo: 10000,
  idempotencyKey: 'key-1',
  consent: {
    version: 'prefunded-card-v1' as const,
    oneTimeCharge: true as const,
  },
};

const setters = () => ({
  setAllowRetry: jest.fn(),
  setBusy: jest.fn(),
  setMessage: jest.fn(),
  setOperation: jest.fn(),
});

beforeEach(() => jest.clearAllMocks());

it.each([
  ['completed', 10000, true],
  ['completed', 9999, true],
  ['completed', 10001, false],
  ['completed', undefined, false],
  ['pending', 10000, false],
] as const)('cancels reminders only for a completed charge covering remaining amount: %s/%s', async (status, remainingAmountKobo, cancels) => {
  jest.mocked(getSavingsCardContributionStatus).mockResolvedValue({
    goalId: snapshot.goalId,
    operationId: 'operation-1',
    amountKobo: snapshot.amountKobo,
    currency: 'NGN',
    status,
  });
  const cancelSavingsReminder = jest.fn().mockResolvedValue(undefined);
  await readSavingsCardContributionStatus({
    allowBusy: false,
    busyRef: { current: false },
    controllers: new Set(),
    goalId: snapshot.goalId,
    isCurrent: () => true,
    snapshot,
    cancelSavingsReminder,
    remainingAmountKobo,
    ...setters(),
  });
  expect(cancelSavingsReminder).toHaveBeenCalledTimes(cancels ? 1 : 0);
  if (cancels)
    expect(cancelSavingsReminder).toHaveBeenCalledWith(snapshot.goalId);
});

it('cancels the completed goal reminder before refresh unmounts the funding flow', async () => {
  jest.mocked(getSavingsCardContributionStatus).mockResolvedValue({
    goalId: snapshot.goalId,
    operationId: 'operation-1',
    amountKobo: snapshot.amountKobo,
    currency: 'NGN',
    status: 'completed',
  });
  let current = true;
  const events: string[] = [];
  const cancelSavingsReminder = jest.fn(async () => {
    events.push('cancel');
  });
  const refreshWallet = jest.fn(async () => {
    events.push('refresh');
    current = false;
  });
  const state = setters();
  await syncSavingsCardContributionStatus({
    goalId: snapshot.goalId,
    isCurrent: () => current,
    snapshot,
    signal: new AbortController().signal,
    cancelSavingsReminder,
    remainingAmountKobo: 10000,
    refreshWallet,
    ...state,
  });
  expect(events).toEqual(['cancel', 'refresh']);
  expect(cancelSavingsReminder).toHaveBeenCalledWith(snapshot.goalId);
  expect(state.setMessage).not.toHaveBeenCalled();
});

it('keeps confirmed completion and wallet refresh when reminder cleanup fails', async () => {
  jest.mocked(getSavingsCardContributionStatus).mockResolvedValue({
    goalId: snapshot.goalId,
    operationId: 'operation-1',
    amountKobo: snapshot.amountKobo,
    currency: 'NGN',
    status: 'completed',
  });
  const cancelSavingsReminder = jest
    .fn()
    .mockRejectedValue(new Error('local cleanup failed'));
  const refreshWallet = jest.fn().mockResolvedValue(undefined);
  const state = setters();
  await syncSavingsCardContributionStatus({
    goalId: snapshot.goalId,
    isCurrent: () => true,
    snapshot,
    signal: new AbortController().signal,
    cancelSavingsReminder,
    remainingAmountKobo: 10000,
    refreshWallet,
    ...state,
  });
  expect(cancelSavingsReminder).toHaveBeenCalledWith(snapshot.goalId);
  expect(refreshWallet).toHaveBeenCalledTimes(1);
  expect(state.setAllowRetry).not.toHaveBeenCalledWith(true);
});

it('refreshes the wallet after a completed recovered contribution', async () => {
  jest.mocked(getSavingsCardContributionStatus).mockResolvedValue({
    goalId: snapshot.goalId,
    operationId: 'operation-1',
    amountKobo: snapshot.amountKobo,
    currency: 'NGN',
    status: 'completed',
  });
  const state = setters();
  const refreshWallet = jest.fn().mockResolvedValue(undefined);

  await syncSavingsCardContributionStatus({
    goalId: snapshot.goalId,
    isCurrent: () => true,
    refreshWallet,
    signal: new AbortController().signal,
    snapshot,
    ...state,
  });

  expect(state.setOperation).toHaveBeenCalledWith({
    goalId: snapshot.goalId,
    operationId: 'operation-1',
    amountKobo: snapshot.amountKobo,
    currency: 'NGN',
    status: 'completed',
  });
  expect(refreshWallet).toHaveBeenCalledTimes(1);
  expect(state.setMessage).toHaveBeenCalledWith(
    'Contribution completed. Refresh your wallet to see the latest balance.'
  );
});

it('cancels the local reminder when a completed charge covers the remaining amount', async () => {
  jest.mocked(getSavingsCardContributionStatus).mockResolvedValue({
    goalId: snapshot.goalId,
    operationId: 'operation-1',
    amountKobo: snapshot.amountKobo,
    currency: 'NGN',
    status: 'completed',
  });
  const state = setters();
  const cancelSavingsReminder = jest.fn().mockResolvedValue(true);

  await syncSavingsCardContributionStatus({
    cancelSavingsReminder,
    goalId: snapshot.goalId,
    isCurrent: () => true,
    refreshWallet: jest.fn().mockResolvedValue(undefined),
    remainingAmountKobo: snapshot.amountKobo,
    signal: new AbortController().signal,
    snapshot,
    ...state,
  });

  expect(cancelSavingsReminder).toHaveBeenCalledWith(snapshot.goalId);
});

it('keeps the local reminder when a completed charge is partial', async () => {
  jest.mocked(getSavingsCardContributionStatus).mockResolvedValue({
    goalId: snapshot.goalId,
    operationId: 'operation-1',
    amountKobo: snapshot.amountKobo,
    currency: 'NGN',
    status: 'completed',
  });
  const state = setters();
  const cancelSavingsReminder = jest.fn().mockResolvedValue(true);

  await syncSavingsCardContributionStatus({
    cancelSavingsReminder,
    goalId: snapshot.goalId,
    isCurrent: () => true,
    refreshWallet: jest.fn().mockResolvedValue(undefined),
    remainingAmountKobo: snapshot.amountKobo + 1,
    signal: new AbortController().signal,
    snapshot,
    ...state,
  });

  expect(cancelSavingsReminder).not.toHaveBeenCalled();
});

it('cancels the reminder even when refresh invalidates the scope', async () => {
  jest.mocked(getSavingsCardContributionStatus).mockResolvedValue({
    goalId: snapshot.goalId,
    operationId: 'operation-1',
    amountKobo: snapshot.amountKobo,
    currency: 'NGN',
    status: 'completed',
  });
  const state = setters();
  const cancelSavingsReminder = jest.fn().mockResolvedValue(true);
  let current = true;

  await syncSavingsCardContributionStatus({
    cancelSavingsReminder,
    goalId: snapshot.goalId,
    isCurrent: () => current,
    refreshWallet: jest.fn().mockImplementation(() => {
      // Completed goals stop rendering the funding panel, unmounting the
      // hook mid-refresh; the cancellation must already have happened.
      current = false;
      return Promise.resolve(undefined);
    }),
    remainingAmountKobo: snapshot.amountKobo,
    signal: new AbortController().signal,
    snapshot,
    ...state,
  });

  expect(cancelSavingsReminder).toHaveBeenCalledWith(snapshot.goalId);
  expect(state.setMessage).not.toHaveBeenCalled();
});

it('keeps the durable request retryable when refreshed status mismatches', async () => {
  jest.mocked(getSavingsCardContributionStatus).mockResolvedValue({
    goalId: snapshot.goalId,
    operationId: 'operation-1',
    amountKobo: snapshot.amountKobo + 1,
    currency: 'NGN',
    status: 'pending',
  });
  const state = setters();
  const busyRef = { current: false };

  await readSavingsCardContributionStatus({
    allowBusy: false,
    busyRef,
    controllers: new Set(),
    goalId: snapshot.goalId,
    isCurrent: () => true,
    snapshot,
    ...state,
  });

  expect(state.setOperation).not.toHaveBeenCalled();
  expect(state.setAllowRetry).toHaveBeenLastCalledWith(true);
  expect(state.setMessage).toHaveBeenCalledWith(
    'Status is unavailable. Your saved request is unchanged; check status before retrying.'
  );
  expect(busyRef.current).toBe(false);
});
