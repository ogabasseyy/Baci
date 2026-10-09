import { expect, it, jest } from '@jest/globals';

const mockPrimary = jest
  .fn<(...args: unknown[]) => Promise<void>>()
  .mockResolvedValue(undefined);
const mockLegacy = jest
  .fn<(...args: unknown[]) => Promise<unknown>>()
  .mockRejectedValue(new Error('Legacy funding must not run'));
jest.mock('./fund-primary-wallet-card', () => ({
  fundPrimaryWalletCard: mockPrimary,
}));
jest.mock('@/lib/wallet-top-up', () => ({ initializeWalletTopUp: mockLegacy }));
jest.mock('@/lib/is-hosted-staging-wallet-top-up-blocked', () => ({
  isHostedStagingWalletTopUpBlocked: () => false,
}));
jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: jest.fn() }),
}));
jest.mock('@/services/analytics', () => ({
  trackError: jest.fn(),
  trackEvent: jest.fn(),
}));
jest.mock('@/services/push-notifications', () => ({
  scheduleLocalNotification: jest.fn(),
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
}));
// Unknown verdicts probe; known verdicts never do.
const mockGetCapability = jest.fn<(...args: unknown[]) => Promise<boolean>>();
const mockReadObserved = jest
  .fn<(...args: unknown[]) => boolean | null>()
  .mockReturnValue(null);
jest.mock('@/lib/piggyvest-primary-capability', () => {
  const actual = jest.requireActual(
    '@/lib/piggyvest-primary-capability'
  ) as typeof import('@/lib/piggyvest-primary-capability');
  return {
    ...actual,
    getPiggyvestPrimaryCapability: (...args: unknown[]) =>
      mockGetCapability(...args),
  };
});
jest.mock('@/lib/piggyvest-primary-capability-cache', () => {
  const actual = jest.requireActual(
    '@/lib/piggyvest-primary-capability-cache'
  ) as typeof import('@/lib/piggyvest-primary-capability-cache');
  return {
    ...actual,
    readObservedPiggyvestPrimaryCapability: (...args: unknown[]) =>
      mockReadObserved(...args),
  };
});
const { fundWallet } =
  require('./wallet-screen.handlers') as typeof import('./wallet-screen.handlers');

it('routes the primary merchant card action away from legacy initialization and credit', async () => {
  const input = {
    activeMerchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
    fundAmount: '1000',
    user: { id: '11111111-1111-4111-8111-111111111111' },
    resetFundPanel: jest.fn(),
    setIsFundPending: jest.fn(),
  };
  await fundWallet(input);
  expect(mockLegacy).not.toHaveBeenCalled();
  expect(mockPrimary).toHaveBeenCalledWith(input);
});
it('recovers a saved primary operation before validating the empty form amount', async () => {
  const { Alert } = require('react-native') as typeof import('react-native');
  const alert = jest.spyOn(Alert, 'alert');
  const input = {
    activeMerchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
    fundAmount: '',
    user: { id: '11111111-1111-4111-8111-111111111111' },
    resetFundPanel: jest.fn(),
    setIsFundPending: jest.fn(),
  };
  await fundWallet(input);
  expect(mockPrimary).toHaveBeenCalledWith(input);
  expect(alert).not.toHaveBeenCalledWith('Invalid Amount', expect.anything());
  expect(mockLegacy).not.toHaveBeenCalled();
});
it('awaits an unknown verdict and routes primary when the probe confirms', async () => {
  mockGetCapability.mockResolvedValueOnce(true);
  const input = {
    activeMerchantId: 'newly-enabled-merchant',
    fundAmount: '1000',
    user: { id: '11111111-1111-4111-8111-111111111111' },
    resetFundPanel: jest.fn(),
    setIsFundPending: jest.fn(),
  };
  await fundWallet(input);
  expect(mockGetCapability).toHaveBeenCalledWith('newly-enabled-merchant');
  expect(mockPrimary).toHaveBeenCalledWith(input);
  expect(mockLegacy).not.toHaveBeenCalled();
});
it('awaits an unknown verdict and falls through to legacy when the probe denies', async () => {
  mockGetCapability.mockResolvedValueOnce(false);
  mockLegacy.mockResolvedValueOnce({
    authorization_url: 'https://pay.example/authorize',
    gateway: 'paystack',
    reference: 'ref-legacy',
    success: true,
  });
  await fundWallet({
    activeMerchantId: 'newly-enabled-merchant',
    fundAmount: '1000',
    user: { id: '11111111-1111-4111-8111-111111111111' },
    resetFundPanel: jest.fn(),
    setIsFundPending: jest.fn(),
  });
  expect(mockGetCapability).toHaveBeenCalledWith('newly-enabled-merchant');
  expect(mockLegacy).toHaveBeenCalledTimes(1);
});
it('blocks funding on an ambiguous probe instead of guessing a rail', async () => {
  const { Alert } = require('react-native') as typeof import('react-native');
  const alert = jest.spyOn(Alert, 'alert');
  const primaryCalls = mockPrimary.mock.calls.length;
  const legacyCalls = mockLegacy.mock.calls.length;
  mockGetCapability.mockRejectedValueOnce(new Error('network down'));
  await fundWallet({
    activeMerchantId: 'newly-enabled-merchant',
    fundAmount: '1000',
    user: { id: '11111111-1111-4111-8111-111111111111' },
    resetFundPanel: jest.fn(),
    setIsFundPending: jest.fn(),
  });
  expect(alert).toHaveBeenCalledWith(
    'Unable to fund wallet',
    'We could not confirm your wallet rail. Please try again.',
    expect.arrayContaining([expect.objectContaining({ text: 'Try again' })])
  );
  expect(mockPrimary.mock.calls.length).toBe(primaryCalls);
  expect(mockLegacy.mock.calls.length).toBe(legacyCalls);
});
it('routes a known non-primary verdict to legacy without probing', async () => {
  // Persistent for this test: both the sync allowlist check and the
  // unknown-verdict guard consult the cache.
  mockReadObserved.mockReturnValue(false);
  try {
    mockGetCapability.mockClear();
    const legacyCalls = mockLegacy.mock.calls.length;
    mockLegacy.mockResolvedValueOnce({
      authorization_url: 'https://pay.example/authorize',
      gateway: 'paystack',
      reference: 'ref-known-legacy',
      success: true,
    });
    await fundWallet({
      activeMerchantId: 'known-legacy-merchant',
      fundAmount: '1000',
      user: { id: '11111111-1111-4111-8111-111111111111' },
      resetFundPanel: jest.fn(),
      setIsFundPending: jest.fn(),
    });
    expect(mockGetCapability).not.toHaveBeenCalled();
    expect(mockLegacy.mock.calls.length).toBe(legacyCalls + 1);
  } finally {
    mockReadObserved.mockReturnValue(null);
  }
});
