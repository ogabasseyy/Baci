import { addSavingsContribution } from '@/lib/customer-savings';
import { isPiggyvestPrimaryMerchant } from '@/lib/is-piggyvest-primary-merchant';
import {
  clearObservedPiggyvestPrimaryCapability,
  observePiggyvestPrimaryCapability,
} from '@/lib/piggyvest-primary-capability-cache';
import { addPiggyvestPrimarySavingsContribution } from '@/lib/piggyvest-primary-savings';
import { checkPiggyvestPrimarySavingsStatus } from '@/lib/piggyvest-primary-savings-status';
import { runBankTransferContribution } from './run-bank-transfer-contribution';
import { createInput } from './use-start-savings-submit.test-utils';

jest.mock('expo-crypto', () => ({ randomUUID: () => 'fresh-op' }));
jest.mock('@/components/ui/show-app-alert', () => ({
  showAppAlert: jest.fn(),
}));
jest.mock('@/lib/customer-savings', () => ({
  addSavingsContribution: jest.fn(),
}));
jest.mock('@/lib/piggyvest-primary-savings', () => ({
  addPiggyvestPrimarySavingsContribution: jest.fn(),
}));
jest.mock('@/lib/piggyvest-primary-savings-status', () => ({
  checkPiggyvestPrimarySavingsStatus: jest.fn(),
}));
jest.mock('@/lib/is-piggyvest-primary-merchant', () => ({
  isPiggyvestPrimaryMerchant: jest.fn(),
}));
jest.mock('@/services/savings-reminder-notifications', () => ({
  cancelSavingsReminderNotification: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(isPiggyvestPrimaryMerchant).mockReturnValue(false);
  jest
    .mocked(addSavingsContribution)
    .mockResolvedValue({ goalStatus: 'active' } as never);
});

// With PiggyVest off for the merchant, the first contribution is the
// production legacy transfer: no primary call and no primary status read.
describe('server keeps PiggyVest off', () => {
  it('submits on the legacy rail with a fresh id', async () => {
    const input = createInput({
      createdGoalId: 'goal-1',
      setInitialContributionRail: jest.fn(),
    });
    await runBankTransferContribution(input as never, 'goal-1', 20000, {
      isMounted: () => true,
    });
    expect(addSavingsContribution).toHaveBeenCalledWith(
      expect.objectContaining({ goalId: 'goal-1', idempotencyKey: 'fresh-op' })
    );
    expect(addPiggyvestPrimarySavingsContribution).not.toHaveBeenCalled();
    expect(checkPiggyvestPrimarySavingsStatus).not.toHaveBeenCalled();
    expect(input.setInitialContributionRail).toHaveBeenCalledWith(
      'fresh-op',
      'legacy'
    );
    expect(input.setShowSuccessModal).toHaveBeenCalledWith(true);
  });

  it('keeps a primary-bound id waiting instead of moving it to legacy', async () => {
    jest
      .mocked(checkPiggyvestPrimarySavingsStatus)
      .mockResolvedValue({ status: 'pending' } as never);
    const input = createInput({
      createdGoalId: 'goal-1',
      initialContributionIdempotencyKey: 'op-1',
      initialContributionRail: 'primary',
    });
    await runBankTransferContribution(input as never, 'goal-1', 20000, {
      isMounted: () => true,
    });
    expect(addSavingsContribution).not.toHaveBeenCalled();
    expect(addPiggyvestPrimarySavingsContribution).not.toHaveBeenCalled();
  });
});

describe('bugfix: new-plan contribution routed by the allowlist after a rollback', () => {
  const PILOT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
  afterEach(() => {
    jest.useRealTimers();
    clearObservedPiggyvestPrimaryCapability();
  });

  it('uses the legacy rail while the live verdict rules PiggyVest out', async () => {
    // Arrange: pilot merchant, but the wallet read just rolled it back.
    jest.mocked(isPiggyvestPrimaryMerchant).mockReturnValue(true);
    observePiggyvestPrimaryCapability(PILOT, false);
    const input = createInput({
      activeMerchantId: PILOT,
      createdGoalId: 'goal-1',
      setInitialContributionRail: jest.fn(),
    });

    // Act
    await runBankTransferContribution(input as never, 'goal-1', 20000, {
      isMounted: () => true,
    });

    // Assert
    expect(addPiggyvestPrimarySavingsContribution).not.toHaveBeenCalled();
    expect(addSavingsContribution).toHaveBeenCalled();
  });

  it('holds a fresh contribution once that ruling-out has just expired', async () => {
    // Arrange: rolled back, then the negative verdict expires.
    jest.useFakeTimers();
    jest.mocked(isPiggyvestPrimaryMerchant).mockReturnValue(true);
    observePiggyvestPrimaryCapability(PILOT, false);
    jest.advanceTimersByTime(61_000);
    const input = createInput({
      activeMerchantId: PILOT,
      createdGoalId: 'goal-1',
    });

    // Act
    await runBankTransferContribution(input as never, 'goal-1', 20000, {
      isMounted: () => true,
    });

    // Assert: nothing debited on either rail.
    expect(addPiggyvestPrimarySavingsContribution).not.toHaveBeenCalled();
    expect(addSavingsContribution).not.toHaveBeenCalled();
    expect(input.setFormError).toHaveBeenCalledWith(
      'We are checking your wallet. Please try again shortly.'
    );
  });
});

describe('bugfix: caller rail and live verdict disagreed after merging #4223', () => {
  const PILOT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
  afterEach(() => {
    clearObservedPiggyvestPrimaryCapability();
  });

  it('keeps a legacy-wallet customer at the pilot on legacy (primaryRail false)', async () => {
    jest.mocked(isPiggyvestPrimaryMerchant).mockReturnValue(true);
    const input = createInput({
      activeMerchantId: PILOT,
      createdGoalId: 'goal-1',
      primaryRail: false,
    });

    await runBankTransferContribution(input as never, 'goal-1', 20000, {
      isMounted: () => true,
    });

    expect(addPiggyvestPrimarySavingsContribution).not.toHaveBeenCalled();
    expect(addSavingsContribution).toHaveBeenCalled();
  });

  it('lets a live rollback override a caller that still says primary', async () => {
    jest.mocked(isPiggyvestPrimaryMerchant).mockReturnValue(true);
    observePiggyvestPrimaryCapability(PILOT, false);
    const input = createInput({
      activeMerchantId: PILOT,
      createdGoalId: 'goal-1',
      primaryRail: true,
    });

    await runBankTransferContribution(input as never, 'goal-1', 20000, {
      isMounted: () => true,
    });

    expect(addPiggyvestPrimarySavingsContribution).not.toHaveBeenCalled();
  });

  it('never falls back to legacy at the pilot while the verdict is unknown', async () => {
    jest.mocked(isPiggyvestPrimaryMerchant).mockReturnValue(true);
    jest
      .mocked(addPiggyvestPrimarySavingsContribution)
      .mockResolvedValue({ status: 'confirmed' } as never);
    const input = createInput({
      activeMerchantId: PILOT,
      createdGoalId: 'goal-1',
    });

    await runBankTransferContribution(input as never, 'goal-1', 20000, {
      isMounted: () => true,
    });

    expect(addSavingsContribution).not.toHaveBeenCalled();
    expect(addPiggyvestPrimarySavingsContribution).toHaveBeenCalled();
  });
});
