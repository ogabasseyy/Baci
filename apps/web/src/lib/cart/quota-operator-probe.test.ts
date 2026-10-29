import { expect, it } from 'vitest';
import { verifyQuotaOperatorProbe } from './quota-operator-probe';

it('verifies two increments and a guard denial without exposing the token', async () => {
  const calls: string[] = [];
  await expect(
    verifyQuotaOperatorProbe(async (name) => {
      calls.push(name);
      if (name !== 'increment_commerce_cart_quota') {
        return {
          data: null,
          error: {
            message: 'Cart quota request is outside its capability scope',
          },
        };
      }
      return {
        data: { count: calls.length, resetTime: 1_800_000_000_000 },
        error: null,
      };
    })
  ).resolves.toBeUndefined();
  expect(calls).toEqual([
    'increment_commerce_cart_quota',
    'increment_commerce_cart_quota',
    '__gigl_hook_reload_canary__',
  ]);
});

it('rejects a response that did not increment the same window', async () => {
  await expect(
    verifyQuotaOperatorProbe(async () => ({
      data: { count: 1, resetTime: 1_800_000_000_000 },
      error: null,
    }))
  ).rejects.toThrow('Cart quota probe failed');
});

it('rejects a sibling denial that did not come from the quota guard', async () => {
  let count = 0;
  await expect(
    verifyQuotaOperatorProbe(async (name) =>
      name === 'increment_commerce_cart_quota'
        ? {
            data: { count: ++count, resetTime: 1_800_000_000_000 },
            error: null,
          }
        : { data: null, error: { message: 'permission denied' } }
    )
  ).rejects.toThrow('Cart quota probe failed');
});
