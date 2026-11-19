import { beforeEach, expect, it } from 'vitest';
import {
  authenticateMerchant,
  createParams,
  createRequest,
  generateDvaTestMocks,
  postGenerateDva,
  resetGenerateDvaMocks,
  unpaidOrder,
  useOrderQueries,
} from './generate-dva-test-support';

beforeEach(resetGenerateDvaMocks);

it.each([
  false,
  true,
])('refuses an Oxygen order before provider work (existing account: %s)', async (hasAccount) => {
  authenticateMerchant();
  useOrderQueries({
    order: { ...unpaidOrder, payment_method: 'oxygen' },
    paymentAccount: hasAccount
      ? {
          account_number: '1234567890',
          bank_name: 'Fixture bank',
          account_name: 'Fixture customer',
          provider: 'paystack',
          expires_at: '2999-01-01T00:00:00Z',
        }
      : null,
  });
  const response = await postGenerateDva(createRequest(), createParams());
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({
    code: 'ORDER_NOT_ELIGIBLE_FOR_DVA',
  });
  expect(
    generateDvaTestMocks.mockGeneratePaymentAccount
  ).not.toHaveBeenCalled();
  expect(generateDvaTestMocks.mockRpc).not.toHaveBeenCalled();
});
