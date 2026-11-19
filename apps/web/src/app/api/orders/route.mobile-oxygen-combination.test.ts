import { beforeEach, expect, it } from 'vitest';
import {
  createOrderRequest,
  getLatestRpc,
  POST,
  resetOrderRouteMocks,
} from './route.transaction-discount-fixtures.test-support';

beforeEach(() => resetOrderRouteMocks('bc1b9fb3-697a-4b87-815b-06423f732d3c'));

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
