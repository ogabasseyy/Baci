import { jest } from '@jest/globals';

const mockRelease = jest.fn<(generation: string) => Promise<void>>(
  async () => undefined
);
const mockWarn = jest.fn<(message: string, error?: unknown) => void>(
  () => undefined
);

jest.mock('@/lib/release-checkout-credit-snapshot', () => ({
  releaseCheckoutCreditSnapshot: (generation: string) =>
    mockRelease(generation),
}));
jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: mockWarn }),
}));

const { releaseCreditAfterDefinitiveRejection } =
  require('./orders-credit-release') as typeof import('./orders-credit-release');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('releaseCreditAfterDefinitiveRejection', () => {
  it.each([
    'VALIDATION_ERROR',
    'AUTH_ERROR',
    'NOT_FOUND',
  ])('releases the frozen choice after a %s rejection', async (code) => {
    await releaseCreditAfterDefinitiveRejection(code, 'gen-1');
    expect(mockRelease).toHaveBeenCalledWith('gen-1');
  });

  it.each([
    'CONFLICT',
    'SERVER_ERROR',
    'TIMEOUT',
    'NETWORK_ERROR',
  ])('retains the frozen choice after an ambiguous %s outcome', async (code) => {
    await releaseCreditAfterDefinitiveRejection(code, 'gen-1');
    expect(mockRelease).not.toHaveBeenCalled();
  });

  it('swallows release failures so the original error still surfaces', async () => {
    mockRelease.mockRejectedValueOnce(new Error('disk full'));
    await expect(
      releaseCreditAfterDefinitiveRejection('VALIDATION_ERROR', 'gen-1')
    ).resolves.toBeUndefined();
    expect(mockWarn).toHaveBeenCalled();
  });
});
