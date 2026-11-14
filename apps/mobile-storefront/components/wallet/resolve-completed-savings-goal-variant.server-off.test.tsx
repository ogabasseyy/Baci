import { resolveSavingsGoalVariant } from '@/lib/customer-savings';
import { resolveCompletedSavingsGoalVariant } from './resolve-completed-savings-goal-variant';

jest.mock('@/lib/customer-savings', () => ({
  ...jest.requireActual('@/lib/customer-savings'),
  resolveSavingsGoalVariant: jest.fn(),
}));

const goal = {
  contribution_amount: 5000,
  contribution_frequency: 'weekly' as const,
  current_amount: 650000,
  id: 'goal-1',
  maturity_date: '2026-11-01',
  selection_unresolved: true,
  source_mode: 'manual' as const,
  status: 'completed' as const,
  target_amount: 650000,
  title: 'iPhone 15',
  variant_resolution_options: [{ id: 'v1', label: '128GB Black' }],
};

describe('saving the exact option of a completed goal', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns true once saved and refreshed, retrying one failed refresh', async () => {
    jest
      .mocked(resolveSavingsGoalVariant)
      .mockResolvedValue(undefined as never);
    const refetchWallet = jest
      .fn<Promise<unknown>, []>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(undefined);
    await expect(
      resolveCompletedSavingsGoalVariant({
        goal,
        refetchWallet,
        variantId: 'v1',
      })
    ).resolves.toBe(true);
    expect(refetchWallet).toHaveBeenCalledTimes(2);
  });

  it('says the choice is saved when the wallet cannot refresh', async () => {
    jest
      .mocked(resolveSavingsGoalVariant)
      .mockResolvedValue(undefined as never);
    const refetchWallet = jest.fn(async () => {
      throw new Error('offline');
    });
    await expect(
      resolveCompletedSavingsGoalVariant({
        goal,
        refetchWallet,
        variantId: 'v1',
      })
    ).resolves.toEqual({
      saved: 'Your choice is saved. Pull down on the wallet to refresh it.',
    });
  });

  it('refuses an option the goal does not offer, without calling the server', async () => {
    const result = await resolveCompletedSavingsGoalVariant({
      goal,
      refetchWallet: jest.fn(async () => undefined),
      variantId: 'nope',
    });
    expect(result).toMatch(/no longer available/);
    expect(resolveSavingsGoalVariant).not.toHaveBeenCalled();
  });

  it('returns the server message when the save is refused', async () => {
    jest
      .mocked(resolveSavingsGoalVariant)
      .mockRejectedValue(new Error('This goal already has an option.'));
    await expect(
      resolveCompletedSavingsGoalVariant({
        goal,
        refetchWallet: jest.fn(async () => undefined),
        variantId: 'v1',
      })
    ).resolves.toBe('This goal already has an option.');
  });
});

describe('bugfix: a failed refresh result closed the picker', () => {
  it('says the choice is saved when the refresh resolves to an error result', async () => {
    jest
      .mocked(resolveSavingsGoalVariant)
      .mockResolvedValue(undefined as never);
    const refetchWallet = jest.fn(async () => ({ isError: true }));
    const result = await resolveCompletedSavingsGoalVariant({
      goal,
      refetchWallet,
      variantId: 'v1',
    });
    expect(result).not.toBe(true);
    expect(result).toEqual({ saved: expect.any(String) });
    expect(refetchWallet).toHaveBeenCalledTimes(2);
  });
});
