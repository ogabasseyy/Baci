import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Alert } from 'react-native';
import { answerWalletFundPrompt } from './fund/answer-wallet-fund-prompt';
import { useWalletFundPromptStore } from './fund/wallet-fund-prompt-store';
import { resolveFundWalletRail } from './resolve-fund-wallet-rail';

const mockGetCapability = jest.fn<(...args: unknown[]) => Promise<boolean>>();
const mockReadObserved = jest.fn<(...args: unknown[]) => boolean | null>();
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

const mockHasRetained = jest.fn<(...args: unknown[]) => Promise<boolean>>();
jest.mock('./has-retained-primary-card-funding', () => ({
  hasRetainedPrimaryCardFunding: (...args: unknown[]) =>
    mockHasRetained(...args),
}));

const PILOT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';

beforeEach(() => {
  jest.clearAllMocks();
  mockReadObserved.mockReturnValue(false);
  mockHasRetained.mockResolvedValue(false);
});

describe('resolveFundWalletRail', () => {
  it('routes the pilot merchant primary without probing', async () => {
    await expect(resolveFundWalletRail(PILOT)).resolves.toBe('primary');
    expect(mockGetCapability).not.toHaveBeenCalled();
  });

  it('routes an observed-primary merchant primary without probing', async () => {
    mockReadObserved.mockReturnValue(true);
    await expect(resolveFundWalletRail('merchant-1')).resolves.toBe('primary');
    expect(mockGetCapability).not.toHaveBeenCalled();
  });

  it('probes an unobserved merchant and honors the verdict', async () => {
    mockReadObserved.mockReturnValue(null);
    mockGetCapability.mockResolvedValueOnce(true);
    await expect(resolveFundWalletRail('merchant-1')).resolves.toBe('primary');
    mockGetCapability.mockResolvedValueOnce(false);
    await expect(resolveFundWalletRail('merchant-1')).resolves.toBe('legacy');
  });

  it('blocks and asks inline (never an iOS alert) when the probe is ambiguous', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockReadObserved.mockReturnValue(null);
    mockGetCapability.mockRejectedValue(new Error('network down'));
    try {
      const onRetry = jest.fn();
      await expect(
        resolveFundWalletRail('merchant-1', { onRetry })
      ).resolves.toBe('blocked');
      const prompt = useWalletFundPromptStore.getState().prompt;
      expect(prompt).toMatchObject({
        title: 'We couldn’t check your wallet',
        message: expect.stringContaining('Nothing was charged'),
        confirmLabel: 'Try again',
      });
      expect(alertSpy).not.toHaveBeenCalled();
      answerWalletFundPrompt(true);
      await Promise.resolve();
      expect(onRetry).toHaveBeenCalledTimes(1);
    } finally {
      alertSpy.mockRestore();
    }
  });

  it('does not retry when the customer answers Not now', async () => {
    mockReadObserved.mockReturnValue(null);
    mockGetCapability.mockRejectedValue(new Error('network down'));
    const onRetry = jest.fn();
    await resolveFundWalletRail('merchant-1', { onRetry });
    answerWalletFundPrompt(false);
    await Promise.resolve();
    expect(onRetry).not.toHaveBeenCalled();
    expect(useWalletFundPromptStore.getState().prompt).toBeNull();
  });

  it('routes a blank merchant id legacy: slug carries the scope and primary needs an id', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    try {
      await expect(resolveFundWalletRail(undefined)).resolves.toBe('legacy');
      await expect(resolveFundWalletRail('')).resolves.toBe('legacy');
      expect(mockGetCapability).not.toHaveBeenCalled();
      expect(alertSpy).not.toHaveBeenCalled();
    } finally {
      alertSpy.mockRestore();
    }
  });
});

describe('bugfix: store credit top-up funded the PiggyVest savings wallet', () => {
  it('routes an IMEI or utility top-up to the legacy rail for the pilot merchant', async () => {
    await expect(
      resolveFundWalletRail(PILOT, { walletReturnTo: '/imei-check' })
    ).resolves.toBe('legacy');
    await expect(
      resolveFundWalletRail(PILOT, {
        walletReturnTo: '/utilities/airtime?repeatAmount=500',
      })
    ).resolves.toBe('legacy');
    expect(mockGetCapability).not.toHaveBeenCalled();
  });

  it('keeps savings and plain top-ups on the primary rail', async () => {
    await expect(
      resolveFundWalletRail(PILOT, { walletReturnTo: '/wallet/savings/start' })
    ).resolves.toBe('primary');
    await expect(
      resolveFundWalletRail(PILOT, { walletReturnTo: '/wallet?action=savings' })
    ).resolves.toBe('primary');
  });
});

describe('bugfix: purchase top-up skipped a saved PiggyVest card funding', () => {
  it('recovers a saved PiggyVest card funding before any new charge', async () => {
    mockHasRetained.mockResolvedValue(true);

    await expect(
      resolveFundWalletRail(PILOT, {
        userId: 'user-1',
        walletReturnTo: '/imei-check',
      })
    ).resolves.toBe('primary');
    expect(mockHasRetained).toHaveBeenCalledWith(PILOT, 'user-1');
  });

  it('uses store credit when nothing is saved', async () => {
    await expect(
      resolveFundWalletRail(PILOT, {
        userId: 'user-1',
        walletReturnTo: '/utilities/airtime',
      })
    ).resolves.toBe('legacy');
  });
});
