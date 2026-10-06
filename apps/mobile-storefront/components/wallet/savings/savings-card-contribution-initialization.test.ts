import {
  clearTerminalSavingsCardContributionSnapshot,
  readSavingsCardContributionSnapshot,
} from '@/lib/savings-card-contribution-snapshot';
import { refreshSavedCardMethods } from './refresh-saved-card-methods';
import {
  initializeSavingsCardContribution,
  prepareNewSavingsCardContribution,
  refreshSavingsCardContributionMethods,
} from './savings-card-contribution-initialization';
import { syncSavingsCardContributionStatus } from './savings-card-contribution-status';

jest.mock('@/lib/savings-card-contribution-snapshot', () => ({
  clearTerminalSavingsCardContributionSnapshot: jest.fn(),
  readSavingsCardContributionSnapshot: jest.fn(),
}));
jest.mock('./refresh-saved-card-methods', () => ({
  refreshSavedCardMethods: jest.fn(),
}));
jest.mock('./savings-card-contribution-status', () => ({
  syncSavingsCardContributionStatus: jest.fn(),
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
const scope = {
  userId: 'customer-1',
  merchantId: 'merchant-1',
  goalId: 'goal-1',
};

const setters = () => ({
  setAllowRetry: jest.fn(),
  setCapabilityLoaded: jest.fn(),
  setEnabled: jest.fn(),
  setLoading: jest.fn(),
  setMaximumAmountKobo: jest.fn(),
  setMessage: jest.fn(),
  setMethods: jest.fn(),
  setOperation: jest.fn(),
  setSelectedMethodId: jest.fn(),
  setSnapshot: jest.fn(),
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(refreshSavedCardMethods).mockResolvedValue(undefined);
});

it('restores the durable contribution before loading current saved cards', async () => {
  jest.mocked(readSavingsCardContributionSnapshot).mockResolvedValue(snapshot);
  const state = setters();

  await initializeSavingsCardContribution({
    goalId: scope.goalId,
    isCurrent: () => true,
    onAmountChange: jest.fn(),
    scope,
    signal: new AbortController().signal,
    ...state,
  });

  expect(state.setSnapshot).toHaveBeenCalledWith(snapshot);
  expect(state.setSelectedMethodId).toHaveBeenCalledWith(
    snapshot.savedMethodId
  );
  expect(syncSavingsCardContributionStatus).toHaveBeenCalledWith(
    expect.objectContaining({ snapshot, goalId: scope.goalId })
  );
  expect(refreshSavedCardMethods).toHaveBeenCalledWith(
    expect.objectContaining({ goalId: scope.goalId })
  );
  expect(state.setLoading).toHaveBeenLastCalledWith(false);
});

it('keeps initialization safe when the durable snapshot cannot be read', async () => {
  jest
    .mocked(readSavingsCardContributionSnapshot)
    .mockRejectedValue(new Error('storage unavailable'));
  const state = setters();

  await initializeSavingsCardContribution({
    goalId: scope.goalId,
    isCurrent: () => true,
    onAmountChange: jest.fn(),
    scope,
    signal: new AbortController().signal,
    ...state,
  });

  expect(state.setMessage).toHaveBeenCalledWith(
    'Saved request state is unavailable. No new contribution can be started.'
  );
  expect(refreshSavedCardMethods).not.toHaveBeenCalled();
  expect(state.setLoading).toHaveBeenLastCalledWith(false);
});

it('does not refresh saved cards after the restored status changes scope', async () => {
  jest.mocked(readSavingsCardContributionSnapshot).mockResolvedValue(snapshot);
  let current = true;
  jest
    .mocked(syncSavingsCardContributionStatus)
    .mockImplementation(async () => {
      current = false;
    });
  const state = setters();

  await initializeSavingsCardContribution({
    goalId: scope.goalId,
    isCurrent: () => current,
    onAmountChange: jest.fn(),
    scope,
    signal: new AbortController().signal,
    ...state,
  });

  expect(refreshSavedCardMethods).not.toHaveBeenCalled();
});

it('keeps current scope guards while reporting saved-card refresh failure', async () => {
  jest
    .mocked(refreshSavedCardMethods)
    .mockImplementation(async ({ onUnavailable }) => {
      onUnavailable();
    });
  const state = setters();

  await refreshSavingsCardContributionMethods({
    goalId: scope.goalId,
    isCurrent: () => true,
    ...state,
  });

  expect(state.setMessage).toHaveBeenCalledWith(
    'Saved cards are temporarily unavailable. Refresh to try again.'
  );
});

it('clears only a terminal durable contribution before preparing another', async () => {
  jest
    .mocked(clearTerminalSavingsCardContributionSnapshot)
    .mockResolvedValue(undefined);
  const state = setters();
  const onAmountChange = jest.fn();

  await prepareNewSavingsCardContribution({
    isCurrent: () => true,
    onAmountChange,
    operationStatus: 'completed',
    scope,
    setMessage: state.setMessage,
    setOperation: state.setOperation,
    setSelectedMethodId: state.setSelectedMethodId,
    setSnapshot: state.setSnapshot,
    snapshot,
  });

  expect(clearTerminalSavingsCardContributionSnapshot).toHaveBeenCalledWith(
    scope,
    snapshot.idempotencyKey,
    'completed'
  );
  expect(state.setSnapshot).toHaveBeenCalledWith(null);
  expect(state.setOperation).toHaveBeenCalledWith(null);
  expect(onAmountChange).toHaveBeenCalledWith('');
});
