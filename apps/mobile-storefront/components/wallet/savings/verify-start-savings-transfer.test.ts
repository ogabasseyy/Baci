import { verifyStartSavingsTransfer } from './verify-start-savings-transfer';

const mockGoals = jest.fn();
jest.mock('@/lib/customer-savings', () => ({
  listSavingsGoals: (...args: unknown[]) => mockGoals(...args),
}));

beforeEach(() => jest.clearAllMocks());

it('does not confirm a partial deposit', async () => {
  mockGoals.mockResolvedValue({
    goals: [{ id: 'goal-1', currentAmount: 99.99 }],
  });
  await expect(
    verifyStartSavingsTransfer({
      goalId: 'goal-1',
      amount: 100,
      merchantId: 'merchant-1',
    })
  ).resolves.toBe(false);
});

it.each([
  0,
  -1,
  Number.NaN,
  Number.POSITIVE_INFINITY,
])('does not confirm an invalid amount %s', async (amount) => {
  await expect(
    verifyStartSavingsTransfer({ goalId: 'goal-1', amount })
  ).resolves.toBe(false);
  expect(mockGoals).not.toHaveBeenCalled();
});

it('does not confirm without a persisted goal', async () => {
  await expect(verifyStartSavingsTransfer()).resolves.toBe(false);
  expect(mockGoals).not.toHaveBeenCalled();
});
