import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { runBankTransferContribution } from './run-bank-transfer-contribution';
import { createInput } from './use-start-savings-submit.test-utils';

const mockAddSavings = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockAddPrimary = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockCheckStatus = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockIsPrimary = jest.fn<(id?: string | null) => boolean>();

jest.mock('expo-crypto', () => ({ randomUUID: () => 'fresh-op' }));
jest.mock('@/lib/customer-savings', () => ({
  addSavingsContribution: (...args: unknown[]) => mockAddSavings(...args),
}));
jest.mock('@/lib/piggyvest-primary-savings', () => ({
  addPiggyvestPrimarySavingsContribution: (...args: unknown[]) =>
    mockAddPrimary(...args),
}));
jest.mock('@/lib/piggyvest-primary-savings-status', () => ({
  checkPiggyvestPrimarySavingsStatus: (...args: unknown[]) =>
    mockCheckStatus(...args),
}));
jest.mock('@/lib/is-piggyvest-primary-merchant', () => ({
  isPiggyvestPrimaryMerchant: (id?: string | null) => mockIsPrimary(id),
}));
jest.mock('@/services/savings-reminder-notifications', () => ({
  cancelSavingsReminderNotification: jest.fn(async () => true),
}));

const run = (railRef: { current: unknown }, overrides = {}) => {
  const input = createInput({
    createdGoalId: 'goal-1',
    effectiveInitialContribution: 20000,
    ...overrides,
  });
  return runBankTransferContribution(input, 'goal-1', 20000, {
    isMounted: () => true,
    railRef: railRef as never,
  }).then(() => input);
};

describe('runBankTransferContribution', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsPrimary.mockReturnValue(true);
    mockAddPrimary.mockResolvedValue({ status: 'confirmed' });
    mockAddSavings.mockResolvedValue({ goalStatus: 'active' });
  });

  it('records the rail with a freshly minted id', async () => {
    const railRef = { current: null };
    const input = await run(railRef);
    expect(input.setInitialContributionIdempotencyKey).toHaveBeenCalledWith(
      'fresh-op'
    );
    expect(railRef.current).toEqual({
      operationId: 'fresh-op',
      rail: 'primary',
    });
  });

  it('sends a legacy-rail id to legacy only, even for a primary merchant', async () => {
    const railRef = { current: { operationId: 'old', rail: 'legacy' } };
    await run(railRef, { initialContributionIdempotencyKey: 'old' });
    expect(mockCheckStatus).not.toHaveBeenCalled();
    expect(mockAddPrimary).not.toHaveBeenCalled();
    expect(mockAddSavings).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'old' })
    );
  });

  it('ignores a recorded rail that belongs to a different id', async () => {
    const railRef = { current: { operationId: 'other', rail: 'primary' } };
    await run(railRef, { initialContributionIdempotencyKey: 'old' });
    expect(mockAddPrimary).not.toHaveBeenCalled();
    expect(mockAddSavings).toHaveBeenCalled();
  });
});
