import { expect, it } from 'vitest';
import { cartQuotaCounterSchema } from './cart-quota-counter';

it('accepts the database integer limit and a safe millisecond timestamp', () => {
  expect(
    cartQuotaCounterSchema.parse({
      count: 2_147_483_647,
      resetTime: 1_800_000_000_000,
    })
  ).toEqual({ count: 2_147_483_647, resetTime: 1_800_000_000_000 });
});

it.each([
  { count: 2_147_483_648, resetTime: 1_800_000_000_000 },
  { count: 1.5, resetTime: 1_800_000_000_000 },
  { count: 0, resetTime: 1_800_000_000_000 },
  { count: '1', resetTime: 1_800_000_000_000 },
  { count: 1, resetTime: Number.MAX_SAFE_INTEGER + 1 },
  { count: 1, resetTime: 1.5 },
])('rejects malformed numeric data from the RPC', (data) => {
  expect(cartQuotaCounterSchema.safeParse(data).success).toBe(false);
});
