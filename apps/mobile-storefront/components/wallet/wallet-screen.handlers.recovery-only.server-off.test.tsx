import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { initializeWalletTopUp } from '@/lib/wallet-top-up';
import { fundWallet } from './wallet-screen.handlers';

const mockReadPending = jest.fn<() => Promise<unknown>>();
const mockStart = jest.fn<() => Promise<unknown>>();
const mockRecover = jest.fn<() => Promise<unknown>>();
// The account that started the top-up is still signed in.
// The PiggyVest store's in-sheet notices are scoped to the signed-in
// account; this test's auth store has no getState.
jest.mock('./savings/current-savings-notice-scope', () => ({
  currentSavingsNoticeScope: () => 'user-1:merchant-1',
}));
jest.mock('./is-same-signed-in-user', () => ({
  isSameSignedInUser: () => true,
}));
jest.mock('@/lib/primary-wallet-card', () => ({
  createPrimaryWalletCardFundingClient: () => ({
    peekRaw: async () => null,
    readPending: () => mockReadPending(),
    recover: () => mockRecover(),
    start: () => mockStart(),
  }),
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/lib/wallet-top-up', () => ({ initializeWalletTopUp: jest.fn() }));
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

const PILOT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const USER = '11111111-1111-4111-8111-111111111111';
const mockInitializeWalletTopUp = jest.mocked(initializeWalletTopUp);

describe('bugfix: recovery fallback started a new PiggyVest charge', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInitializeWalletTopUp.mockResolvedValue({
      authorization_url: 'https://pay.example/authorize',
      gateway: 'paystack',
      reference: 'ref-1',
      success: true,
    });
  });

  it('adds store credit, never a PiggyVest charge, when the saved-funding check fails then finds nothing', async () => {
    // Arrange: the rail check can't read storage; the recovery read finds none.
    mockReadPending
      .mockRejectedValueOnce(new Error('storage busy'))
      .mockResolvedValueOnce(null);

    // Act
    await fundWallet({
      activeMerchantId: PILOT,
      fundAmount: '1000',
      resetFundPanel: jest.fn(),
      setIsFundPending: jest.fn(),
      user: { id: USER } as never,
      walletReturnTo: '/imei-check',
    });

    // Assert
    expect(mockStart).not.toHaveBeenCalled();
    expect(mockInitializeWalletTopUp).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 1000, returnTo: '/imei-check' })
    );
  });
});
