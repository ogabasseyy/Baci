import { jest } from '@jest/globals';

const mockApply = jest.fn<
  (payload: unknown, generation: string) => Promise<unknown>
>(async (payload: unknown) => payload);
const mockBuildPayload = jest.fn<(input: unknown) => { items: never[] }>(
  () => ({ items: [] })
);

jest.mock('@/lib/checkout-attempt-credit-snapshot', () => ({
  applyCheckoutCreditSnapshot: (payload: unknown, generation: string) =>
    mockApply(payload, generation),
}));
jest.mock('./orders.payload', () => ({
  buildOrderPayload: (input: unknown) => mockBuildPayload(input),
}));

const { buildSnapshottedOrderPayload } =
  require('./orders-credit-freeze') as typeof import('./orders-credit-freeze');

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
