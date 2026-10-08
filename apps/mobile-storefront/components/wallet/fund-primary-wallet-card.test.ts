import { beforeEach, expect, it, jest } from '@jest/globals';
import { router } from 'expo-router';
import { Alert } from 'react-native';

const mockRead = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockStart = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockRecover = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockCapability = jest.fn<(...args: unknown[]) => Promise<unknown>>();
jest.mock('@/lib/primary-wallet-card', () => ({
  createPrimaryWalletCardFundingClient: () => ({
    readPending: mockRead,
    start: mockStart,
    recover: mockRecover,
  }),
}));
jest.mock('@/lib/piggyvest-primary-capability', () => {
  const actual = jest.requireActual(
    '@/lib/piggyvest-primary-capability'
  ) as typeof import('@/lib/piggyvest-primary-capability');
  return { ...actual, getPiggyvestPrimaryCapability: mockCapability };
});
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
}));
const { fundPrimaryWalletCard } =
  require('./fund-primary-wallet-card') as typeof import('./fund-primary-wallet-card');
const input = {
  activeMerchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
  fundAmount: '1000',
  user: { id: '11111111-1111-4111-8111-111111111111' },
  resetFundPanel: jest.fn(),
  setIsFundPending: jest.fn(),
  walletReturnTo: '/wallet',
};
const response = {
  status: 'ready',
  amountKobo: 100000,
  reference: 'pvb-first-primary-22222222-2222-4222-8222-222222222222',
  authorizationUrl: 'https://checkout.paystack.com/Synthetic123',
  returnTo: '/wallet',
};
const alert = jest.spyOn(Alert, 'alert');
beforeEach(() => {
  jest.clearAllMocks();
  mockCapability.mockResolvedValue(true);
  mockRead.mockResolvedValue(null);
  mockStart.mockResolvedValue(response);
  mockRecover.mockResolvedValue(response);
  alert.mockImplementation((_title, _message, buttons) => {
    buttons
      ?.find((button) => button.text === 'Authorize one-time charge')
      ?.onPress?.();
  });
});
it('requires actual one-time-charge UI consent and sends no save-card or BVN inference', async () => {
  await fundPrimaryWalletCard(input);
  expect(alert).toHaveBeenCalledWith(
    'Confirm card wallet funding',
    expect.stringContaining(
      'Money appears in your wallet after funding is confirmed'
    ),
    expect.any(Array),
    expect.any(Object)
  );
  expect(alert.mock.calls[0][1]).not.toMatch(/custody/i);
  expect(mockStart).toHaveBeenCalledWith({
    merchantId: input.activeMerchantId,
    userId: input.user.id,
    amountKobo: 100000,
    consent: {
      version: 'primary-wallet-card-v1',
      oneTimeCharge: true,
      saveCard: false,
    },
    returnTo: '/wallet',
  });
  expect(router.push).toHaveBeenCalledWith({
    pathname: '/payment-gateway',
    params: expect.objectContaining({
      paymentKind: 'primary_wallet_card',
      gateway: 'paystack',
      reference: response.reference,
    }),
  });
});
it('does not initialize on cancelled consent', async () => {
  alert.mockImplementation((_title, _message, buttons) => {
    buttons?.find((button) => button.text === 'Cancel')?.onPress?.();
  });
  await fundPrimaryWalletCard(input);
  expect(mockStart).not.toHaveBeenCalled();
  expect(router.push).not.toHaveBeenCalled();
});
it('recovers the persisted operation instead of accepting a new amount/choice after restart', async () => {
  mockRead.mockResolvedValue({ operationId: 'persisted' });
  mockRecover.mockResolvedValue({ status: 'custody_pending' });
  await fundPrimaryWalletCard(input);
  expect(mockRecover).toHaveBeenCalledWith({
    merchantId: input.activeMerchantId,
    userId: input.user.id,
  });
  expect(mockStart).not.toHaveBeenCalled();
  expect(router.push).not.toHaveBeenCalled();
  expect(input.resetFundPanel).not.toHaveBeenCalled();
  expect(Alert.alert).toHaveBeenCalledWith(
    'Card funding pending',
    expect.stringContaining('saved')
  );
});
it('does not expose checkout or credit after a failed or unavailable primary runtime', async () => {
  mockStart.mockRejectedValueOnce(new Error('PRIMARY_CARD_NOT_READY'));
  await fundPrimaryWalletCard(input);
  expect(router.push).not.toHaveBeenCalled();
  expect(input.resetFundPanel).not.toHaveBeenCalled();
});
it('rethrows unconfigured primary silently so the caller can run the legacy top-up', async () => {
  mockCapability.mockResolvedValue(false);
  await expect(fundPrimaryWalletCard(input)).rejects.toMatchObject({
    code: 'PRIMARY_CARD_NOT_READY',
  });
  expect(mockRead).toHaveBeenCalledWith({
    merchantId: input.activeMerchantId,
    userId: input.user.id,
  });
  expect(mockStart).not.toHaveBeenCalled();
  expect(alert).not.toHaveBeenCalled();
  expect(input.setIsFundPending).toHaveBeenLastCalledWith(false);
});
it('recovers a saved checkout before trusting an unavailable capability probe', async () => {
  mockCapability.mockResolvedValue(false);
  mockRead.mockResolvedValue({ operationId: 'persisted' });
  mockRecover.mockResolvedValue({ status: 'custody_pending' });
  await fundPrimaryWalletCard(input);
  expect(mockRecover).toHaveBeenCalledWith({
    merchantId: input.activeMerchantId,
    userId: input.user.id,
  });
  expect(mockStart).not.toHaveBeenCalled();
  expect(Alert.alert).toHaveBeenCalledWith(
    'Card funding pending',
    expect.stringContaining('saved')
  );
});
it('keeps a saved checkout instead of falling back when recovery reports unavailable', async () => {
  mockRead.mockResolvedValue({ operationId: 'persisted' });
  mockRecover.mockRejectedValue(
    Object.assign(new Error('unavailable'), { code: 'PRIMARY_CARD_NOT_READY' })
  );
  await fundPrimaryWalletCard(input);
  expect(Alert.alert).toHaveBeenCalledWith(
    'Card funding could not be confirmed',
    expect.stringContaining('retained')
  );
});
it('resumes the stored real savings handoff only after completed restart recovery', async () => {
  const returnTo =
    '/wallet?action=savings&savingsGoalId=owned-goal&savingsAmount=1000';
  mockRead.mockResolvedValue({ operationId: 'persisted' });
  mockRecover.mockResolvedValue({ status: 'completed', returnTo });
  await fundPrimaryWalletCard(input);
  expect(mockStart).not.toHaveBeenCalled();
  expect(router.push).not.toHaveBeenCalled();
  expect(router.replace).toHaveBeenCalledWith(returnTo);
});
