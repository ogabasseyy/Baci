import { describe, expect, it, vi } from 'vitest';
import { requireActiveSavingsGoal } from './require-active-savings-goal';

const scope = {
  merchantId: '10000000-0000-4000-8000-000000000001',
  customerId: '20000000-0000-4000-8000-000000000001',
  goalId: '30000000-0000-4000-8000-000000000001',
};

function supabaseFor(goal: unknown, error: unknown = null) {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({ data: goal, error }),
            })),
          })),
        })),
      })),
    })),
  };
}

describe('requireActiveSavingsGoal', () => {
  it('accepts only an owned active goal', async () => {
    await expect(
      requireActiveSavingsGoal({
        ...scope,
        supabase: supabaseFor({ id: scope.goalId, status: 'active' }) as never,
      })
    ).resolves.toBeNull();
  });

  it('hides a missing or foreign goal', async () => {
    const response = await requireActiveSavingsGoal({
      ...scope,
      supabase: supabaseFor(null) as never,
    });

    expect(response?.status).toBe(404);
  });

  it('reports a lookup failure as retryable instead of missing', async () => {
    const response = await requireActiveSavingsGoal({
      ...scope,
      supabase: supabaseFor(null, { message: 'connection reset' }) as never,
    });

    expect(response?.status).toBe(500);
    await expect(response?.json()).resolves.toMatchObject({
      code: 'SAVINGS_GOAL_LOOKUP_FAILED',
    });
  });
});
