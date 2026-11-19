import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { runBankTransferContribution } from './run-bank-transfer-contribution';
import { createInput } from './use-start-savings-submit.test-utils';

const mockAddSavings = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockAddPrimary = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockCheckStatus = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockShowAlert = jest.fn();

jest.mock('expo-crypto', () => ({ randomUUID: () => 'fresh-op' }));
jest.mock('@/components/ui/show-app-alert', () => ({
  showAppAlert: (...args: unknown[]) => mockShowAlert(...args),
}));
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
  isPiggyvestPrimaryMerchant: () => true,
}));
jest.mock('@/services/savings-reminder-notifications', () => ({
  cancelSavingsReminderNotification: jest.fn(async () => true),
}));

const proof = createHash('sha256').update('s5m-start-proof').digest('hex');
const needsPin = () =>
  Object.assign(new Error('Please confirm your PIN to continue.'), {
    code: 'PIN_PROOF_REQUIRED',
  });

const run = (
  requestPinProof?: (request: unknown) => Promise<string | null>,
  overrides = {}
) => {
  const input = createInput({
    createdGoalId: 'goal-1',
    effectiveInitialContribution: 20000,
    initialContributionIdempotencyKey: 'stored-op',
    initialContributionRail: 'primary',
    ...overrides,
  });
  return runBankTransferContribution(input as never, 'goal-1', 20000, {
    isMounted: () => true,
    requestPinProof: requestPinProof as never,
  }).then(() => input);
};

describe('wallet PIN on the first contribution', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckStatus.mockResolvedValue({
      status: 'pending',
      operationId: 'stored-op',
    });
  });

  it('opens the PIN prompt for the stored id and amount, then retries on the same id and rail with the proof', async () => {
    mockAddPrimary
      .mockRejectedValueOnce(needsPin())
      .mockResolvedValueOnce({ status: 'confirmed' });
    const ask = jest.fn(async () => proof);
    const input = await run(ask);
    expect(ask).toHaveBeenCalledWith({
      merchantId: 'merchant-1',
      goalId: 'goal-1',
      operationId: 'stored-op',
      amountKobo: 2000000,
    });
    expect(mockAddPrimary).toHaveBeenCalledTimes(2);
    expect(mockAddPrimary).toHaveBeenLastCalledWith(
      expect.objectContaining({
        idempotencyKey: 'stored-op',
        pinProof: proof,
        allowLegacyFallback: false,
      })
    );
    expect(mockAddSavings).not.toHaveBeenCalled();
    expect(input.setInitialContributionRail).not.toHaveBeenCalledWith(
      'stored-op',
      'legacy'
    );
    expect(input.setShowSuccessModal).toHaveBeenCalledWith(true);
    expect(mockShowAlert).not.toHaveBeenCalled();
  });

  it('keeps the id and rail and tells the customer the goal exists when they close the prompt', async () => {
    mockAddPrimary.mockRejectedValue(needsPin());
    const input = await run(jest.fn(async () => null));
    expect(mockAddPrimary).toHaveBeenCalledTimes(1);
    expect(mockAddSavings).not.toHaveBeenCalled();
    expect(input.setInitialContributionIdempotencyKey).not.toHaveBeenCalledWith(
      null
    );
    expect(input.setInitialContributionRail).not.toHaveBeenCalledWith(
      'stored-op',
      'legacy'
    );
    expect(input.setShowSuccessModal).not.toHaveBeenCalled();
    const message =
      "Your goal was created. Add money to it from your wallet when you're ready.";
    expect(input.setFormError).toHaveBeenCalledWith(message);
    expect(mockShowAlert).toHaveBeenCalledWith(
      expect.objectContaining({ message, variant: 'info' })
    );
  });

  it('shows the server copy and no "coming soon" when no prompt is available', async () => {
    mockAddPrimary.mockRejectedValue(needsPin());
    const input = await run(undefined);
    expect(input.setFormError).toHaveBeenCalledWith(
      'Please confirm your PIN to continue.'
    );
    expect(JSON.stringify(mockShowAlert.mock.calls)).not.toContain(
      'coming soon'
    );
    expect(mockAddPrimary).toHaveBeenCalledTimes(1);
  });

  it('never asks for a PIN on the legacy rail', async () => {
    mockAddSavings.mockResolvedValue({ goalStatus: 'active' });
    const ask = jest.fn(async () => proof);
    await run(ask, { initialContributionRail: 'legacy' });
    expect(ask).not.toHaveBeenCalled();
    expect(mockAddSavings).toHaveBeenCalledWith(
      expect.not.objectContaining({ pinProof: expect.anything() })
    );
  });

  it('does not retry when the retry itself fails for another reason', async () => {
    mockAddPrimary
      .mockRejectedValueOnce(needsPin())
      .mockRejectedValueOnce(new Error('timed out'));
    const input = await run(jest.fn(async () => proof));
    expect(mockAddPrimary).toHaveBeenCalledTimes(2);
    expect(input.setFormError).toHaveBeenCalledWith('timed out');
    expect(input.setInitialContributionIdempotencyKey).not.toHaveBeenCalledWith(
      null
    );
  });
});
