import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  fundPrimaryWalletCard,
  NOTHING_TO_RECOVER,
} from './fund-primary-wallet-card';

const mockReadPending = jest.fn<() => Promise<unknown>>();
const mockStart = jest.fn<() => Promise<unknown>>();
const mockGetCapability = jest.fn<() => Promise<boolean>>();
jest.mock('@/lib/primary-wallet-card', () => ({
  createPrimaryWalletCardFundingClient: () => ({
    readPending: () => mockReadPending(),
    recover: jest.fn(),
    start: () => mockStart(),
  }),
}));
jest.mock('@/lib/piggyvest-primary-capability', () => ({
  getPiggyvestPrimaryCapability: () => mockGetCapability(),
  isVerifiedEmailRequired: () => false,
  rollbackObservedCapabilityOnNotReady: () => false,
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

const MERCHANT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const USER = '0f8fad5b-d9cb-469f-a165-70867728950e';

describe('PiggyVest card funding with the server keeping PiggyVest off', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReadPending.mockResolvedValue(null);
    mockGetCapability.mockResolvedValue(false);
  });

  it('hands a purchase top-up with nothing saved back for store credit', async () => {
    const outcome = await fundPrimaryWalletCard({
      activeMerchantId: MERCHANT,
      fundAmount: '1000',
      resetFundPanel: jest.fn(),
      setIsFundPending: jest.fn(),
      user: { id: USER } as never,
      walletReturnTo: '/imei-check',
    });

    expect(outcome).toBe(NOTHING_TO_RECOVER);
    expect(mockGetCapability).not.toHaveBeenCalled();
    expect(mockStart).not.toHaveBeenCalled();
  });
});
