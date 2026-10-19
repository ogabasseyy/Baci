import { getSavingsFirstCardCapability } from '@/lib/savings-first-card-checkout';
import {
  readSavingsFirstCardCheckoutSnapshot,
  type SavingsFirstCardScope,
} from '@/lib/savings-first-card-checkout-snapshot';
import { initializeSavingsFirstCardCheckout } from './initialize-savings-first-card-checkout';

jest.mock('@/lib/savings-first-card-checkout', () => ({
  getSavingsFirstCardCapability: jest.fn(),
}));
jest.mock('@/lib/savings-first-card-checkout-snapshot', () => ({
  readSavingsFirstCardCheckoutSnapshot: jest.fn(),
}));

const scope: SavingsFirstCardScope = {
  userId: 'user-1',
  merchantId: 'merchant-1',
  goalId: 'goal-1',
};
const setters = () => ({
  amountChange: jest.fn(),
  setAllowRetry: jest.fn(),
  setEnabled: jest.fn(),
  setLoading: jest.fn(),
  setMaximumAmountKobo: jest.fn(),
  setMessage: jest.fn(),
  setRecoveryBlocked: jest.fn(),
  setSnapshot: jest.fn(),
  setStatus: jest.fn(),
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(readSavingsFirstCardCheckoutSnapshot).mockResolvedValue(null);
  jest.mocked(getSavingsFirstCardCapability).mockResolvedValue({
    goalId: scope.goalId,
    enabled: false,
    maximumAmountKobo: 0,
    currency: 'NGN',
  });
});

it('keeps first-card capability disabled when stored recovery cannot be read', async () => {
  jest
    .mocked(readSavingsFirstCardCheckoutSnapshot)
    .mockRejectedValue(new Error('storage'));
  const state = setters();

  await initializeSavingsFirstCardCheckout({
    ...state,
    activation: 1,
    isCurrent: () => true,
    refreshStatus: jest.fn(),
    requestScope: scope,
    requestScopeKey: 'scope-key',
    signal: new AbortController().signal,
  });

  expect(state.setRecoveryBlocked).toHaveBeenCalledWith(true);
  expect(state.setEnabled).toHaveBeenCalledWith(false);
  expect(getSavingsFirstCardCapability).not.toHaveBeenCalled();
});

it('loads disabled capability while preserving recovery access to a saved request', async () => {
  const request = {
    goalId: scope.goalId,
    intentId: null,
    amountKobo: 10000,
    idempotencyKey: '00000000-0000-4000-8000-000000000001',
    consent: {
      version: 'prefunded-first-card-v1' as const,
      oneTimeCharge: true as const,
      saveCard: true as const,
    },
  };
  jest.mocked(readSavingsFirstCardCheckoutSnapshot).mockResolvedValue(request);
  const state = setters();
  const refreshStatus = jest.fn().mockResolvedValue(undefined);

  await initializeSavingsFirstCardCheckout({
    ...state,
    activation: 1,
    isCurrent: () => true,
    refreshStatus,
    requestScope: scope,
    requestScopeKey: 'scope-key',
    signal: new AbortController().signal,
  });

  expect(state.setSnapshot).toHaveBeenCalledWith(request);
  expect(refreshStatus).not.toHaveBeenCalled();
  expect(state.setEnabled).toHaveBeenCalledWith(false);
  expect(state.setLoading).toHaveBeenCalledWith(false);
});
