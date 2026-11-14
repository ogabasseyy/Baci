import { resolveSavingsGoalVariant } from '@/lib/customer-savings';
import { createSavingsVariantResolutionHandler } from './savings-variant-resolution.handlers';

jest.mock('@/lib/customer-savings', () => ({
  resolveSavingsGoalVariant: jest.fn(),
}));

const goal = {
  id: 'goal-1',
  status: 'completed',
  selection_unresolved: true,
  variant_resolution_options: [{ id: 'v1', label: '128GB Black' }],
} as never;

// With PiggyVest off, the handler still only calls the server for an option
// the goal offers, and reports a refusal as a message, not a crash.
describe('server keeps PiggyVest off: variant resolution handler', () => {
  it('refuses an option the goal does not offer without calling the server', async () => {
    const handler = createSavingsVariantResolutionHandler({
      goal,
      refetchWallet: jest.fn(async () => undefined),
    });
    await expect(handler('not-offered')).resolves.toBe(
      'That option is no longer available. Pull to refresh and try again.'
    );
    expect(resolveSavingsGoalVariant).not.toHaveBeenCalled();
  });

  it('passes the server refusal back as a message', async () => {
    jest
      .mocked(resolveSavingsGoalVariant)
      .mockRejectedValue(new Error('Savings are off right now.'));
    const handler = createSavingsVariantResolutionHandler({
      activeMerchantId: 'm-1',
      goal,
      refetchWallet: jest.fn(async () => undefined),
    });
    await expect(handler('v1')).resolves.toBe('Savings are off right now.');
    expect(resolveSavingsGoalVariant).toHaveBeenCalledWith(
      expect.objectContaining({ goalId: 'goal-1', variantId: 'v1' })
    );
  });
});
