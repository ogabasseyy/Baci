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
it('confirms the adopted amount before opening a resumed checkout', async () => {
  mockStart.mockResolvedValue({ ...response, adopted: true });
  alert.mockImplementation((_title, _message, buttons) => {
    (
      buttons?.find((button) => button.text === 'Authorize one-time charge') ??
      buttons?.find((button) => button.text === 'Cancel')
    )?.onPress?.();
  });
  await fundPrimaryWalletCard(input);
  expect(alert).toHaveBeenCalledWith(
    'Resume pending funding',
    expect.stringContaining('₦1,000.00'),
    expect.any(Array),
    expect.any(Object)
  );
  // A declined resume keeps the adopted checkout closed and retained.
  expect(router.push).not.toHaveBeenCalled();
  expect(input.resetFundPanel).not.toHaveBeenCalled();
  expect(alert).toHaveBeenCalledWith(
    'Card funding pending',
    expect.stringContaining('saved')
  );
});
it('warns when an adopted checkout would save the card', async () => {
  mockStart.mockResolvedValue({ ...response, adopted: true, saveCard: true });
  alert.mockImplementation((_title, _message, buttons) => {
    (
      buttons?.find((button) => button.text === 'Authorize one-time charge') ??
      buttons?.find((button) => button.text === 'Cancel')
    )?.onPress?.();
  });
  await fundPrimaryWalletCard(input);
  // The consent prompt promised the card will not be saved; the stored
  // checkout says otherwise, so the resume dialog must say so too.
  expect(alert).toHaveBeenCalledWith(
    'Resume pending funding',
    expect.stringContaining('save your card'),
    expect.any(Array),
    expect.any(Object)
  );
  expect(router.push).not.toHaveBeenCalled();
});
it('opens the adopted checkout only after explicit resume confirmation', async () => {
  mockStart.mockResolvedValue({ ...response, adopted: true });
  alert.mockImplementation((_title, _message, buttons) => {
    (
      buttons?.find((button) => button.text === 'Authorize one-time charge') ??
      buttons?.find((button) => String(button.text).startsWith('Resume'))
    )?.onPress?.();
  });
  await fundPrimaryWalletCard(input);
  expect(router.push).toHaveBeenCalledWith({
    pathname: '/payment-gateway',
    params: expect.objectContaining({
      reference: response.reference,
      amount: '1000',
    }),
  });
});
it('reports a closed adoption without opening checkout', async () => {
  mockStart.mockResolvedValue({
    ...response,
    adopted: true,
    status: 'abandoned',
    authorizationUrl: undefined,
  });
  await fundPrimaryWalletCard(input);
  expect(alert).toHaveBeenCalledWith(
    'Previous funding closed',
    expect.stringContaining('Start a new funding')
  );
  expect(router.push).not.toHaveBeenCalled();
  expect(input.resetFundPanel).toHaveBeenCalled();
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
it('falls back when recovery drops a stale placeholder on not-ready', async () => {
  // Pre-call read sees the stale null-operation placeholder; the request
  // drops it on the authoritative response, so the catch re-read finds
  // nothing retained and the caller runs the legacy top-up.
  mockRead.mockResolvedValueOnce({ operationId: null });
  mockRead.mockResolvedValue(null);
  mockRecover.mockRejectedValue(
    Object.assign(new Error('unavailable'), { code: 'PRIMARY_CARD_NOT_READY' })
  );
  await expect(fundPrimaryWalletCard(input)).rejects.toMatchObject({
    code: 'PRIMARY_CARD_NOT_READY',
  });
  expect(alert).not.toHaveBeenCalled();
});
it('debounces repeat taps for one scope without blocking another account', async () => {
  const other = {
    ...input,
    user: { id: '22222222-2222-4222-8222-222222222222' },
    setIsFundPending: jest.fn(),
    resetFundPanel: jest.fn(),
  };
  await Promise.all([
    fundPrimaryWalletCard(input),
    fundPrimaryWalletCard(input),
    fundPrimaryWalletCard(other),
  ]);
  expect(mockStart).toHaveBeenCalledTimes(2);
  expect(mockStart).toHaveBeenCalledWith(
    expect.objectContaining({ userId: input.user.id })
  );
  expect(mockStart).toHaveBeenCalledWith(
    expect.objectContaining({ userId: other.user.id })
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
it.each([
  ['', 'Enter an amount greater than zero.'],
  ['0', 'Enter an amount greater than zero.'],
  ['-50', 'Enter an amount greater than zero.'],
  ['10.123', 'Enter an amount with no more than two decimal places.'],
  ['1e6', 'Enter an amount with no more than two decimal places.'],
  ['0x10', 'Enter an amount with no more than two decimal places.'],
  ['abc', 'Enter a valid amount using digits only.'],
  ['100000000', 'Enter a smaller amount.'],
  ['0.01', 'Enter an amount of at least ₦50.00.'],
  ['49.99', 'Enter an amount of at least ₦50.00.'],
])('rejects invalid amount %p with a specific message before consent', async (fundAmount, message) => {
  await fundPrimaryWalletCard({ ...input, fundAmount });
  expect(alert).toHaveBeenCalledWith('Check the amount', message);
  expect(mockStart).not.toHaveBeenCalled();
});
it('accepts exactly the Paystack minimum without a consent-blocking error', async () => {
  await fundPrimaryWalletCard({ ...input, fundAmount: '50' });
  expect(alert).not.toHaveBeenCalledWith(
    'Check the amount',
    expect.any(String)
  );
  expect(mockStart).toHaveBeenCalledWith(
    expect.objectContaining({ amountKobo: 5000 })
  );
});
it('renders the exact kobo-derived amount in the consent prompt', async () => {
  await fundPrimaryWalletCard({ ...input, fundAmount: '1250.5' });
  expect(alert).toHaveBeenCalledWith(
    'Confirm card wallet funding',
    expect.stringContaining('₦1,250.50'),
    expect.any(Array),
    expect.any(Object)
  );
  expect(mockStart).toHaveBeenCalledWith(
    expect.objectContaining({ amountKobo: 125050 })
  );
});
it('accepts thousands separators and surrounding whitespace', async () => {
  await fundPrimaryWalletCard({ ...input, fundAmount: ' 1,000 ' });
  expect(mockStart).toHaveBeenCalledWith(
    expect.objectContaining({ amountKobo: 100000 })
  );
});
it('re-sanitizes a tampered handoff before navigating on completed recovery', async () => {
  mockRead.mockResolvedValue({ operationId: 'persisted' });
  mockRecover.mockResolvedValue({
    status: 'completed',
    returnTo: 'https://evil.test/phish',
  });
  await fundPrimaryWalletCard(input);
  expect(router.replace).toHaveBeenCalledWith('/wallet');
});
it('refreshes the wallet balance before confirming a completed funding', async () => {
  const refetchWalletBalance = jest.fn<() => Promise<unknown>>();
  refetchWalletBalance.mockResolvedValue(undefined);
  mockRead.mockResolvedValue({ operationId: 'persisted' });
  mockRecover.mockResolvedValue({ status: 'completed', returnTo: '/wallet' });
  await fundPrimaryWalletCard({ ...input, refetchWalletBalance });
  expect(refetchWalletBalance).toHaveBeenCalledTimes(1);
  expect(alert).toHaveBeenCalledWith(
    'Funding confirmed',
    'Your wallet funding is confirmed.'
  );
});
it('still confirms when the balance refresh fails', async () => {
  const refetchWalletBalance = jest.fn<() => Promise<unknown>>();
  refetchWalletBalance.mockRejectedValue(new Error('offline'));
  mockRead.mockResolvedValue({ operationId: 'persisted' });
  mockRecover.mockResolvedValue({ status: 'completed', returnTo: '/wallet' });
  await fundPrimaryWalletCard({ ...input, refetchWalletBalance });
  expect(alert).toHaveBeenCalledWith(
    'Funding confirmed',
    'Your wallet funding is confirmed.'
  );
});
