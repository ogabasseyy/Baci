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

  it.each([
    ['primary', true],
    ['legacy', false],
  ])('records the %s rail before the network call', async (rail, primary) => {
    mockIsPrimary.mockReturnValue(primary);
    const railRef: { current: unknown } = { current: null };
    let seen: unknown = 'unset';
    const spy = async () => {
      seen = railRef.current;
      return {};
    };
    mockAddPrimary.mockImplementation(spy);
    mockAddSavings.mockImplementation(spy);
    await run(railRef);
    expect(seen).toEqual({ operationId: 'fresh-op', rail });
  });

  it('forbids legacy fallback for a kept primary id but not a fresh one', async () => {
    mockCheckStatus.mockResolvedValue({ status: 'pending' });
    const kept = { current: { operationId: 'old', rail: 'primary' } };
    await run(kept, { initialContributionIdempotencyKey: 'old' });
    expect(mockAddPrimary).toHaveBeenLastCalledWith(
      expect.objectContaining({ allowLegacyFallback: false })
    );
    await run({ current: null });
    expect(mockAddPrimary).toHaveBeenLastCalledWith(
      expect.objectContaining({ allowLegacyFallback: true })
    );
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

  it('asks primary about a recorded rail that belongs to a different id', async () => {
    mockCheckStatus.mockResolvedValue({ status: 'pending' });
    const railRef = { current: { operationId: 'other', rail: 'legacy' } };
    await run(railRef, { initialContributionIdempotencyKey: 'old' });
    expect(mockCheckStatus).toHaveBeenCalled();
    expect(mockAddSavings).not.toHaveBeenCalled();
    expect(mockAddPrimary).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'old' })
    );
  });

  it('resubmits an unrecorded id on legacy when primary has no record', async () => {
    mockCheckStatus.mockRejectedValue(
      Object.assign(new Error('nf'), { code: 'CONTRIBUTION_NOT_FOUND' })
    );
    const railRef = { current: null };
    await run(railRef, { initialContributionIdempotencyKey: 'old' });
    expect(mockAddPrimary).not.toHaveBeenCalled();
    expect(mockAddSavings).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'old' })
    );
    expect(railRef.current).toEqual({ operationId: 'old', rail: 'legacy' });
  });
});
