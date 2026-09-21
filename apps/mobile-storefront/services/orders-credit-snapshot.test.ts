import { jest } from '@jest/globals';

const mockApply = jest.fn<
  (payload: unknown, generation: string) => Promise<unknown>
>(async (payload: unknown) => payload);
const mockRelease = jest.fn<(generation: string) => Promise<void>>(
  async () => undefined
);
const mockBuildPayload = jest.fn<(input: unknown) => { items: never[] }>(
  () => ({ items: [] })
);
const mockWarn = jest.fn<(message: string, error?: unknown) => void>(
  () => undefined
);

jest.mock('@/lib/checkout-attempt-credit-snapshot', () => ({
  applyCheckoutCreditSnapshot: (payload: unknown, generation: string) =>
    mockApply(payload, generation),
  releaseCheckoutCreditSnapshot: (generation: string) =>
    mockRelease(generation),
}));
jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: mockWarn }),
}));
jest.mock('./orders.payload', () => ({
  buildOrderPayload: (input: unknown) => mockBuildPayload(input),
}));

const { buildSnapshottedOrderPayload, releaseCreditAfterDefinitiveRejection } =
  require('./orders-credit-snapshot') as typeof import('./orders-credit-snapshot');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('buildSnapshottedOrderPayload', () => {
  it('freezes the built payload credit fields under the checkout generation', async () => {
    // orders.payload is mocked; only the passthrough is asserted.
    const input = { merchantId: 'm', request: {} } as never;
    await buildSnapshottedOrderPayload(input, 'gen-1');
    expect(mockBuildPayload).toHaveBeenCalledWith(input);
    expect(mockApply).toHaveBeenCalledWith({ items: [] }, 'gen-1');
  });

  it('propagates snapshot failures to the caller', async () => {
    mockApply.mockRejectedValueOnce(new Error('store hung'));
    const input = { merchantId: 'm', request: {} } as never;
    await expect(buildSnapshottedOrderPayload(input, 'gen-1')).rejects.toThrow(
      'store hung'
    );
  });
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
