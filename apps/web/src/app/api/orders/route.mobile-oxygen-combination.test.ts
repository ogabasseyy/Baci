import { beforeEach, expect, it, vi } from 'vitest';
import { computeCanonicalOrderSubtotal } from '@/lib/checkout/canonical-order-subtotal';
import { readOxygenMobileCapabilities } from '@/lib/payments/oxygen/mobile-capabilities';
import {
  createOrderRequest,
  getLatestRpc,
  MERCHANT_ID,
  POST,
  resetOrderRouteMocks,
  setNextOrderTax,
} from './route.transaction-discount-fixtures.test-support';

vi.mock('@/lib/checkout/canonical-order-subtotal', async (load) => ({
  ...(await load<typeof import('@/lib/checkout/canonical-order-subtotal')>()),
  computeCanonicalOrderSubtotal: vi.fn(),
}));
vi.mock('@/lib/payments/oxygen/mobile-capabilities', () => ({
  readOxygenMobileCapabilities: vi.fn(async () => ({
    ok: true,
    capabilities: { mobileEnabled: true, merchant: { id: MERCHANT_ID } },
  })),
}));
vi.mock('@/lib/loyalty/server-resolver-client', () => ({
  createLoyaltyResolverServiceClient: () => ({
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
  }),
}));
vi.mock('@/lib/supabase/anon', () => ({ createAnonClient: () => ({}) }));

beforeEach(() => resetOrderRouteMocks('bc1b9fb3-697a-4b87-815b-06423f732d3c'));

it('lets web checkout save an unpaid Oxygen order without using native admission', async () => {
  const response = await POST(
    createOrderRequest({ source: 'online_store', payment_method: 'oxygen' })
  );
  expect(response.status).toBeLessThan(400);
  expect(readOxygenMobileCapabilities).not.toHaveBeenCalled();
  expect(getLatestRpc()).toHaveBeenCalledWith(
    'create_storefront_order',
    expect.objectContaining({
      p_payment_method: 'oxygen',
      p_payment_status: 'unpaid',
    })
  );
});

it('permits only replay reads when Bearer Oxygen admission is closed', async () => {
  vi.mocked(readOxygenMobileCapabilities).mockResolvedValueOnce({
    ok: false,
    status: 404,
  });
  const request = createOrderRequest({
    source: 'online_store',
    payment_method: 'oxygen',
  });
  request.headers.set('Authorization', 'Bearer test-token');
  request.headers.set(
    'Idempotency-Key',
    '43276b67-0362-4d83-a522-eb445dc11735'
  );

  const response = await POST(request);

  expect(response.status).toBe(409);
  await expect(response.json()).resolves.toMatchObject({
    code: 'OXYGEN_MOBILE_UNAVAILABLE',
  });
  expect(readOxygenMobileCapabilities).toHaveBeenCalledWith(
    expect.anything(),
    'test-merchant'
  );
  expect(getLatestRpc().mock.calls.map(([operation]) => operation)).toEqual([
    'storefront_checkout_replay_snapshot',
  ]);
});

it('rejects a fresh mobile order with a server-priced zero subtotal and no discount', async () => {
  vi.mocked(computeCanonicalOrderSubtotal).mockResolvedValueOnce(0);
  setNextOrderTax(0);
  const request = createOrderRequest({
    payment_method: 'oxygen',
    items: [
      { product_id: 'p-mac', quantity: 1, price: 0, name: 'Test product' },
    ],
    subtotal: 0,
    tax_amount: 0,
  });
  const response = await POST(request);
  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toMatchObject({
    code: 'OXYGEN_MOBILE_ZERO_BALANCE',
  });
  expect(computeCanonicalOrderSubtotal).toHaveBeenCalledOnce();
  expect(getLatestRpc()).not.toHaveBeenCalledWith(
    'create_storefront_order',
    expect.anything()
  );
});

it('rejects a guest retry even when it supplies a mobile Oxygen order key', async () => {
  resetOrderRouteMocks();
  const request = createOrderRequest({
    source: 'mobile_app',
    payment_method: 'oxygen',
  });
  request.headers.set(
    'Idempotency-Key',
    '43276b67-0362-4d83-a522-eb445dc11735'
  );
  expect((await POST(request)).status).toBe(401);
  expect(readOxygenMobileCapabilities).not.toHaveBeenCalled();
  expect(getLatestRpc()).not.toHaveBeenCalled();
});

it.each([
  {
    items: [
      {
        product_id: 'p-mac',
        quantity: 1,
        price: 980,
        name: 'MacBook Air M1',
        voucher_token: 'submitted-voucher',
      },
    ],
  },
  { wallet_amount: 100 },
  { use_wallet_credit: true },
  { savings_amount: 100 },
  {
    use_savings_credit: true,
    savings_goal_id: '123e4567-e89b-12d3-a456-426614174000',
    savings_amount: 100,
  },
])('rejects a mobile Oxygen order using vouchers or credit %j', async (patch) => {
  const response = await POST(
    createOrderRequest({ payment_method: 'oxygen', ...patch })
  );
  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toMatchObject({
    code: 'OXYGEN_MOBILE_COMBINATION_UNSUPPORTED',
  });
  expect(getLatestRpc()).not.toHaveBeenCalled();
});

it('requires a voucher-like discount string to resolve to a valid merchant discount before creating a mobile Oxygen order', async () => {
  const rpc = getLatestRpc();
  rpc.mockResolvedValue({ data: [], error: null });
  const response = await POST(
    createOrderRequest({
      payment_method: 'oxygen',
      discount_code: 'submitted-voucher',
    })
  );

  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toMatchObject({
    code: 'discount_code_invalid',
  });
  expect(rpc).toHaveBeenCalledWith(
    'get_storefront_discount_code',
    expect.anything()
  );
  expect(rpc).not.toHaveBeenCalledWith(
    'create_storefront_order_with_discount_code',
    expect.anything()
  );
  expect(rpc).not.toHaveBeenCalledWith(
    'create_storefront_order',
    expect.anything()
  );
  expect(rpc).not.toHaveBeenCalledWith(
    'create_storefront_order_with_quiz_voucher',
    expect.anything()
  );
});
