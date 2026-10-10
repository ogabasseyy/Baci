import { getSavingsFirstCardCapability } from '@/lib/savings-first-card-checkout';
import { refreshSavedSavingsFirstCardStatus } from './refresh-savings-first-card-status';
import { runSavingsFirstCardStatusRefresh } from './run-savings-first-card-status-refresh';

jest.mock('@/lib/savings-first-card-checkout', () => ({
  getSavingsFirstCardCapability: jest.fn(),
}));
jest.mock('@/lib/savings-first-card-checkout-snapshot', () => ({
  clearRetiredSavingsFirstCardCheckoutSnapshot: jest.fn(),
}));
jest.mock('./refresh-savings-first-card-status', () => ({
  refreshSavedSavingsFirstCardStatus: jest.fn(),
}));

const scope = { userId: 'user', merchantId: 'merchant', goalId: 'goal' };
const snapshot = {
  goalId: 'goal',
  amountKobo: 12500,
  idempotencyKey: 'saved-key',
  consent: {
    version: 'prefunded-first-card-v1' as const,
    oneTimeCharge: true as const,
    saveCard: true as const,
  },
  intentId: 'intent',
  status: 'pending' as const,
};

function dependencies() {
  return {
    activation: 2,
    isCurrent: jest.fn(() => true),
    onCompleted: jest.fn(),
    refreshWallet: jest.fn(),
    requestScope: scope,
    requestScopeKey: 'scope-key',
    setAllowRetry: jest.fn(),
    setEnabled: jest.fn(),
    setMaximumAmountKobo: jest.fn(),
    setMessage: jest.fn(),
    setSnapshot: jest.fn(),
    setStatus: jest.fn(),
    snapshot,
    statusRequestRef: { current: null as Promise<void> | null },
  };
}

beforeEach(() => jest.clearAllMocks());

it('refreshes capability after status refresh while preserving scope fencing', async () => {
  jest.mocked(getSavingsFirstCardCapability).mockResolvedValue({
    goalId: scope.goalId,
    enabled: true,
    maximumAmountKobo: 30000,
    currency: 'NGN',
  });
  const input = dependencies();

  await runSavingsFirstCardStatusRefresh(input);

  expect(refreshSavedSavingsFirstCardStatus).toHaveBeenCalledWith(
    expect.objectContaining({ requestScope: scope, snapshot })
  );
  const { refreshCapability } = jest.mocked(refreshSavedSavingsFirstCardStatus)
    .mock.calls[0][0];
  await refreshCapability();
  expect(getSavingsFirstCardCapability).toHaveBeenCalledWith({
    goalId: scope.goalId,
  });
  expect(input.setEnabled).toHaveBeenCalledWith(true);
  expect(input.setMaximumAmountKobo).toHaveBeenCalledWith(30000);
});

it('fails closed when capability refresh fails or the checkout scope changes', async () => {
  const input = dependencies();
  jest
    .mocked(getSavingsFirstCardCapability)
    .mockRejectedValue(new Error('offline'));
  await runSavingsFirstCardStatusRefresh(input);
  const { refreshCapability } = jest.mocked(refreshSavedSavingsFirstCardStatus)
    .mock.calls[0][0];
  await refreshCapability();
  expect(input.setEnabled).toHaveBeenCalledWith(false);
  expect(input.setMaximumAmountKobo).toHaveBeenCalledWith(0);

  input.isCurrent.mockReturnValue(false);
  input.setEnabled.mockClear();
  await refreshCapability();
  expect(input.setEnabled).not.toHaveBeenCalled();
});
