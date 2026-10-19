import { expect, it } from 'vitest';
import { conditionOfferUnavailableResponse } from './order-condition-response';

it('returns the stable condition-offer client error', async () => {
  const response = conditionOfferUnavailableResponse();
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: 'Condition offer unavailable; refresh your cart',
    details: 'invalid_condition_offer',
  });
});
