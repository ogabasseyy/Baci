import { describe, expect, it } from '@jest/globals';
import { mockFetchWithTimeout } from '@/lib/wallet-top-up.test-utils';

const { resolveSavingsGoalVariant } =
  require('./customer-savings-variant-resolution') as typeof import('./customer-savings-variant-resolution');

describe('customer savings variant resolution client', () => {
  it('resolves a completed goal with only merchant, goal, and variant identity', async () => {
    mockFetchWithTimeout.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        goalId: '00000000-0000-4000-8000-000000000101',
        goalStatus: 'completed',
        success: true,
      }),
    });

    await expect(
      resolveSavingsGoalVariant({
        goalId: '00000000-0000-4000-8000-000000000101',
        merchantSlug: 'ogabassey',
        variantId: '00000000-0000-4000-8000-000000000102',
      })
    ).resolves.toEqual({
      goalId: '00000000-0000-4000-8000-000000000101',
      goalStatus: 'completed',
      success: true,
    });

    expect(mockFetchWithTimeout).toHaveBeenCalledWith(
      'https://usebaci.com/api/storefront/customer/savings/goals/resolve-variant',
      expect.objectContaining({
        body: JSON.stringify({
          goalId: '00000000-0000-4000-8000-000000000101',
          merchantSlug: 'ogabassey',
          variantId: '00000000-0000-4000-8000-000000000102',
        }),
        method: 'POST',
      })
    );
  });

  it('rejects a resolve response for a different goal', async () => {
    mockFetchWithTimeout.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        goalId: '00000000-0000-4000-8000-000000000999',
        goalStatus: 'completed',
        success: true,
      }),
    });

    await expect(
      resolveSavingsGoalVariant({
        goalId: '00000000-0000-4000-8000-000000000101',
        variantId: '00000000-0000-4000-8000-000000000102',
      })
    ).rejects.toThrow(
      'Savings goal response did not match the requested goal.'
    );
  });
});
