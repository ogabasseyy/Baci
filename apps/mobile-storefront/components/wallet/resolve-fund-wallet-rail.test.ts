import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Alert } from 'react-native';
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

const PILOT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';

beforeEach(() => {
  jest.clearAllMocks();
  mockReadObserved.mockReturnValue(false);
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

  it('blocks with a retry alert when the probe is ambiguous', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockReadObserved.mockReturnValue(null);
    mockGetCapability.mockRejectedValue(new Error('network down'));
    try {
      const onRetry = jest.fn();
      await expect(
        resolveFundWalletRail('merchant-1', { onRetry })
      ).resolves.toBe('blocked');
      expect(alertSpy).toHaveBeenCalledWith(
        'Unable to fund wallet',
        'We could not confirm your wallet rail. Please try again.',
        expect.any(Array)
      );
    } finally {
      alertSpy.mockRestore();
    }
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
