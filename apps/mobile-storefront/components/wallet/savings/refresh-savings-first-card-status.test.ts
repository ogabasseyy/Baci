import { refreshSavingsFirstCardCheckout } from '@/lib/savings-first-card-checkout';
import {
  clearRetiredSavingsFirstCardCheckoutSnapshot,
  recordSavingsFirstCardCheckoutState,
} from '@/lib/savings-first-card-checkout-snapshot';
import { refreshSavedSavingsFirstCardStatus } from './refresh-savings-first-card-status';

jest.mock('@/lib/savings-first-card-checkout', () => ({
  refreshSavingsFirstCardCheckout: jest.fn(),
}));
jest.mock('@/lib/savings-first-card-checkout-snapshot', () => ({
  clearRetiredSavingsFirstCardCheckoutSnapshot: jest.fn(),
  recordSavingsFirstCardCheckoutState: jest.fn(),
}));

const snapshot = {
  goalId: '00000000-0000-4000-8000-000000000001',
  amountKobo: 12500,
  idempotencyKey: '00000000-0000-4000-8000-000000000002',
  consent: {
    version: 'prefunded-first-card-v1' as const,
    oneTimeCharge: true as const,
    saveCard: true as const,
  },
  intentId: '00000000-0000-4000-8000-000000000003',
  status: 'ready' as const,
  authorizationUrl: 'https://checkout.paystack.com/access123',
};
const response = {
  intentId: snapshot.intentId,
  goalId: snapshot.goalId,
  amountKobo: snapshot.amountKobo,
  currency: 'NGN' as const,
  status: 'pending' as const,
};
const scope = {
  userId: 'user',
  merchantId: 'merchant',
  goalId: snapshot.goalId,
};

function dependencies() {
  return {
    activation: 1,
    clearRetiredSnapshot: clearRetiredSavingsFirstCardCheckoutSnapshot,
    isCurrent: (_key: string, _activation: number) => true,
    refreshWallet: jest.fn(),
    refreshCapability: jest.fn(),
    requestScope: scope,
    requestScopeKey: 'scope',
    setAllowRetry: jest.fn(),
    setMessage: jest.fn(),
    setSnapshot: jest.fn(),
    setStatus: jest.fn(),
    snapshot,
    statusRequestRef: { current: null as Promise<void> | null },
  };
}

beforeEach(() => jest.clearAllMocks());

it('clears the in-flight request after a synchronous verification failure', async () => {
  jest.mocked(refreshSavingsFirstCardCheckout).mockImplementationOnce(() => {
    throw new Error('Verification unavailable');
  });
  const input = dependencies();

  await expect(
    refreshSavedSavingsFirstCardStatus(input)
  ).resolves.toBeUndefined();

  expect(input.statusRequestRef.current).toBeNull();
  expect(input.setMessage).toHaveBeenCalledWith(
    expect.stringContaining('Status is unavailable')
  );
  expect(clearRetiredSavingsFirstCardCheckoutSnapshot).not.toHaveBeenCalled();
  expect(input.setSnapshot).not.toHaveBeenCalled();
});

it('refreshes and records only canonical status, preserving payment as pending', async () => {
  jest.mocked(refreshSavingsFirstCardCheckout).mockResolvedValue(response);
  const input = dependencies();
  await refreshSavedSavingsFirstCardStatus(input);
  expect(recordSavingsFirstCardCheckoutState).toHaveBeenCalledWith(
    scope,
    snapshot.idempotencyKey,
    response
  );
  expect(input.setStatus).toHaveBeenCalledWith('pending');
  expect(input.refreshWallet).not.toHaveBeenCalled();
});

it('does not persist or display a response after the request scope changes', async () => {
  const input = dependencies();
  input.isCurrent = (key, activation) => key === 'scope' && activation === 2;
  jest.mocked(refreshSavingsFirstCardCheckout).mockResolvedValue(response);
  await refreshSavedSavingsFirstCardStatus(input);
  expect(recordSavingsFirstCardCheckoutState).not.toHaveBeenCalled();
  expect(input.setMessage).not.toHaveBeenCalled();
});

it('refuses a mismatched canonical intent and never treats it as completion', async () => {
  jest.mocked(refreshSavingsFirstCardCheckout).mockResolvedValue({
    ...response,
    status: 'completed',
    intentId: '00000000-0000-4000-8000-000000000004',
  });
  const input = dependencies();
  await refreshSavedSavingsFirstCardStatus(input);
  expect(recordSavingsFirstCardCheckoutState).not.toHaveBeenCalled();
  expect(clearRetiredSavingsFirstCardCheckoutSnapshot).not.toHaveBeenCalled();
  expect(input.setStatus).not.toHaveBeenCalledWith('completed');
});

it('clears only the exact retired request and announces explicit new-payment availability', async () => {
  const retired = { ...response, status: 'retired_unconfirmed' as const };
  jest.mocked(refreshSavingsFirstCardCheckout).mockResolvedValue(retired);
  const input = dependencies();
  await refreshSavedSavingsFirstCardStatus(input);

  expect(clearRetiredSavingsFirstCardCheckoutSnapshot).toHaveBeenCalledWith(
    scope,
    snapshot.idempotencyKey,
    snapshot.intentId
  );
  expect(input.setSnapshot).toHaveBeenCalledWith(null);
  expect(input.setStatus).toHaveBeenCalledWith('retired_unconfirmed');
  expect(input.refreshCapability).toHaveBeenCalledTimes(1);
  expect(input.setMessage).toHaveBeenCalledWith(
    expect.stringMatching(/closed for review.*start a new payment/i)
  );
  expect(recordSavingsFirstCardCheckoutState).not.toHaveBeenCalled();
});
