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
