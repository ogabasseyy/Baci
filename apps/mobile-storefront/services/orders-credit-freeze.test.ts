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

it('passes canonical provenance unchanged into the credit snapshot boundary', async () => {
  const shared_cart = {
    cart_id: '11111111-1111-4111-8111-111111111111',
    checkout_session_id: '22222222-2222-4222-8222-222222222222',
    checkout_generation: 1,
    cart_version: 4,
  };
  const payload = { items: [], shared_cart };
  mockBuildPayload.mockReturnValueOnce(payload);
  await buildSnapshottedOrderPayload(
    { merchantId: 'm', request: {} } as never,
    'gen-1'
  );
  expect(mockApply).toHaveBeenCalledWith(payload, 'gen-1');
});
