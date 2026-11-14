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
const mockCancelReminder = jest.fn<(id: string) => Promise<boolean>>();
jest.mock('@/services/savings-reminder-notifications', () => ({
  cancelSavingsReminderNotification: (id: string) => mockCancelReminder(id),
}));

const run = (overrides = {}) => {
  const input = createInput({
    createdGoalId: 'goal-1',
    effectiveInitialContribution: 20000,
    setInitialContributionRail: jest.fn(),
    ...overrides,
  });
  return runBankTransferContribution(input as never, 'goal-1', 20000, {
    isMounted: () => true,
  }).then(() => input);
};

describe('runBankTransferContribution', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsPrimary.mockReturnValue(true);
    mockAddPrimary.mockResolvedValue({ status: 'confirmed' });
    mockAddSavings.mockResolvedValue({ goalStatus: 'active' });
  });

  describe('bugfix: a legacy-wallet customer at a PiggyVest merchant was sent to the primary rail', () => {
    it('starts a fresh payment on legacy when the customer has a legacy wallet', async () => {
      mockIsPrimary.mockReturnValue(true);
      const input = await run({ primaryRail: false });
      expect(mockAddSavings).toHaveBeenCalled();
      expect(mockAddPrimary).not.toHaveBeenCalled();
      expect(input.setInitialContributionRail).toHaveBeenCalledWith(
        'fresh-op',
        'legacy'
      );
    });

    it('still lets the merchant decide while the verdict is unknown', async () => {
      mockIsPrimary.mockReturnValue(true);
      await run();
      expect(mockAddPrimary).toHaveBeenCalled();
    });
  });

  it('records the rail with a freshly minted id', async () => {
    const input = await run();
    expect(input.setInitialContributionIdempotencyKey).toHaveBeenCalledWith(
      'fresh-op'
    );
    expect(input.setInitialContributionRail).toHaveBeenCalledWith(
      'fresh-op',
      'primary'
    );
  });

  it.each([
    ['primary', true],
    ['legacy', false],
  ])('records the %s rail before the network call', async (rail, primary) => {
    mockIsPrimary.mockReturnValue(primary);
    const order: string[] = [];
    const spy = async () => {
      order.push('request');
      return {};
    };
    mockAddPrimary.mockImplementation(spy);
    mockAddSavings.mockImplementation(spy);
    const setRail = jest.fn(() => {
      order.push('rail');
    });
    const input = await run({ setInitialContributionRail: setRail });
    expect(order[0]).toBe('rail');
    expect(input.setInitialContributionRail).toHaveBeenCalledWith(
      'fresh-op',
      rail
    );
  });

  it('forbids legacy fallback for a kept primary id but not a fresh one', async () => {
    mockCheckStatus.mockResolvedValue({ status: 'pending' });
    await run({
      initialContributionIdempotencyKey: 'old',
      initialContributionRail: 'primary',
    });
    expect(mockAddPrimary).toHaveBeenLastCalledWith(
      expect.objectContaining({ allowLegacyFallback: false })
    );
    await run();
    expect(mockAddPrimary).toHaveBeenLastCalledWith(
      expect.objectContaining({ allowLegacyFallback: true })
    );
  });

  it('sends a legacy-rail id to legacy only, even for a primary merchant', async () => {
    await run({
      initialContributionIdempotencyKey: 'old',
      initialContributionRail: 'legacy',
    });
    expect(mockCheckStatus).not.toHaveBeenCalled();
    expect(mockAddPrimary).not.toHaveBeenCalled();
    expect(mockAddSavings).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'old' })
    );
  });

  it('resubmits a restored legacy rail on legacy when the status route says SAVINGS_NOT_READY', async () => {
    mockCheckStatus.mockRejectedValue(
      Object.assign(new Error('nr'), { code: 'SAVINGS_NOT_READY' })
    );
    const input = await run({
      initialContributionIdempotencyKey: 'old',
      initialContributionRail: 'legacy',
    });
    expect(mockCheckStatus).not.toHaveBeenCalled();
    expect(mockAddSavings).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'old' })
    );
    expect(input.setFormError).not.toHaveBeenCalledWith(
      expect.stringContaining('Could not confirm')
    );
  });

  it('stays fail-closed for an unrecorded id when the status route says SAVINGS_NOT_READY', async () => {
    mockCheckStatus.mockRejectedValue(
      Object.assign(new Error('nr'), { code: 'SAVINGS_NOT_READY' })
    );
    await run({ initialContributionIdempotencyKey: 'old' });
    expect(mockAddSavings).not.toHaveBeenCalled();
    expect(mockAddPrimary).not.toHaveBeenCalled();
  });

  it('submits an unrecorded id on legacy for a merchant that is not primary', async () => {
    mockIsPrimary.mockReturnValue(false);
    mockCheckStatus.mockRejectedValue(
      Object.assign(new Error('x'), { code: 'SAVINGS_MERCHANT_NOT_PRIMARY' })
    );
    await run({ initialContributionIdempotencyKey: 'old' });
    expect(mockAddPrimary).not.toHaveBeenCalled();
    expect(mockAddSavings).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'old' })
    );
  });

  it('cancels the reminder by the rail that handled it, not the rail started on', async () => {
    mockAddPrimary.mockImplementation(async (arg) => {
      (arg as { onRail?: (r: string) => void }).onRail?.('legacy');
      return { goalStatus: 'active' };
    });
    await run({ targetValue: 20000 });
    expect(mockCancelReminder).not.toHaveBeenCalled();
    mockAddPrimary.mockResolvedValue({ status: 'confirmed' });
    await run({ targetValue: 20000 });
    expect(mockCancelReminder).toHaveBeenCalledWith('goal-1');
  });

  it('resubmits an unrecorded id on legacy when primary has no record', async () => {
    mockCheckStatus.mockRejectedValue(
      Object.assign(new Error('nf'), { code: 'CONTRIBUTION_NOT_FOUND' })
    );
    const input = await run({ initialContributionIdempotencyKey: 'old' });
    expect(mockAddPrimary).not.toHaveBeenCalled();
    expect(mockAddSavings).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'old' })
    );
    expect(input.setInitialContributionRail).toHaveBeenCalledWith(
      'old',
      'legacy'
    );
  });
});
