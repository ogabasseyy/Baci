import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Alert } from 'react-native';

const mockRead = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockStart = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockCapability = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockNotify = jest.fn();
const mockAsk = jest.fn();
jest.mock('@/lib/primary-wallet-card', () => ({
  createPrimaryWalletCardFundingClient: () => ({
    readPending: mockRead,
    start: mockStart,
    recover: jest.fn(),
  }),
}));
jest.mock('@/lib/piggyvest-primary-capability', () => {
  const actual = jest.requireActual(
    '@/lib/piggyvest-primary-capability'
  ) as typeof import('@/lib/piggyvest-primary-capability');
  return { ...actual, getPiggyvestPrimaryCapability: mockCapability };
});
jest.mock('./savings/savings-notifier', () => ({
  savingsNotifier: () => mockNotify,
}));
jest.mock('./fund/ask-wallet-fund', () => ({ askWalletFund: mockAsk }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
const { fundPrimaryWalletCard } =
  require('./fund-primary-wallet-card') as typeof import('./fund-primary-wallet-card');

describe('card funding with the server keeping PiggyVest off', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRead.mockResolvedValue(null);
    mockCapability.mockResolvedValue(false);
  });

  it('hands back to the regular top-up silently: no notice, question or alert', async () => {
    const iosAlert = jest.spyOn(Alert, 'alert');

    await expect(
      fundPrimaryWalletCard({
        activeMerchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
        fundAmount: '1000',
        user: { id: '11111111-1111-4111-8111-111111111111' },
        resetFundPanel: jest.fn(),
        setIsFundPending: jest.fn(),
      })
    ).rejects.toMatchObject({ code: 'PRIMARY_CARD_NOT_READY' });

    expect(mockStart).not.toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
    expect(mockAsk).not.toHaveBeenCalled();
    expect(iosAlert).not.toHaveBeenCalled();
  });
});
