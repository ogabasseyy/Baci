import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { addSavingsContribution } from '@/lib/customer-savings';
import { addPiggyvestPrimarySavingsContribution } from '@/lib/piggyvest-primary-savings';
import { isPinCancelled } from '@/lib/wallet-pin-proof';
import { createWalletSavingsActions } from './use-wallet-savings-actions';
import { addSavingsContributionToGoal } from './wallet-screen-savings.handlers';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'synthetic-key' }));
jest.mock('./check-pending-primary-savings', () => ({
  checkPendingPrimarySavings: jest.fn(),
}));
jest.mock('@/lib/customer-savings', () => ({
  addSavingsContribution: jest.fn(),
}));
jest.mock('@/lib/piggyvest-primary-savings', () => ({
  addPiggyvestPrimarySavingsContribution: jest.fn(),
}));
jest.mock('@/services/savings-reminder-notifications', () => ({
  cancelSavingsReminderNotification: jest.fn(),
}));
jest.mock('./wallet-screen-savings.handlers', () => ({
  addSavingsContributionToGoal: jest.fn(),
}));

const PILOT_MERCHANT_ID = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const proof = createHash('sha256').update('s5m-wallet-proof').digest('hex');
const goal: WalletActiveSavingsGoal = {
  id: 'goal-1',
  title: 'Synthetic device',
  status: 'active',
  source_mode: 'manual',
  current_amount: 100,
  target_amount: 700000,
  contribution_amount: 100,
  contribution_frequency: 'weekly',
  maturity_date: '2026-12-01',
};
const needsPin = () =>
  Object.assign(new Error('Please confirm your PIN to continue.'), {
    code: 'PIN_PROOF_REQUIRED',
  });

function setup(requestPinProof?: (r: unknown) => Promise<string | null>) {
  const operationRailRef = { current: null as 'primary' | 'legacy' | null };
  const idempotencyKeyRef = { current: null as string | null };
  createWalletSavingsActions({
    activeMerchantId: PILOT_MERCHANT_ID,
    goal,
    idempotencyKeyRef,
    operationRailRef,
    refetchWallet: jest.fn(async () => undefined),
    savingsContributionAmount: '2500',
    walletBalance: 5000,
    startWalletTopUp: jest.fn(),
    requestPinProof: requestPinProof as never,
    setIsAddingSavingsContribution: jest.fn(),
    setShowSavingsProgressModal: jest.fn(),
    setSavingsContributionAmount: jest.fn(),
  }).handleAddSavingsContribution();
  const params = jest.mocked(addSavingsContributionToGoal).mock.calls[0]?.[0];
  const key = params?.createIdempotencyKey() ?? '';
  const contribution = {
    amount: 2500,
    goalId: goal.id,
    idempotencyKey: key,
    merchantId: PILOT_MERCHANT_ID,
  };
  return { params, contribution, key, operationRailRef, idempotencyKeyRef };
}

describe('wallet-screen wallet PIN', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('asks for the PIN on a clean refusal and retries the stored id on primary with the proof', async () => {
    jest
      .mocked(addPiggyvestPrimarySavingsContribution)
      .mockRejectedValueOnce(needsPin())
      .mockResolvedValueOnce({
        status: 'confirmed',
        operationId: 'synthetic-key',
      });
    const ask = jest.fn(async () => proof);
    const { params, contribution, key, operationRailRef, idempotencyKeyRef } =
      setup(ask);
    await expect(
      params?.addSavingsContribution(contribution)
    ).resolves.toMatchObject({ status: 'confirmed' });
    expect(ask).toHaveBeenCalledWith({
      merchantId: PILOT_MERCHANT_ID,
      goalId: goal.id,
      operationId: key,
      amountKobo: 250000,
    });
    expect(addPiggyvestPrimarySavingsContribution).toHaveBeenLastCalledWith(
      expect.objectContaining({ idempotencyKey: key, pinProof: proof })
    );
    expect(addSavingsContribution).not.toHaveBeenCalled();
    expect(idempotencyKeyRef.current).toBe(key);
    expect(operationRailRef.current).toBe('primary');
  });

  it('reports a closed sheet as a cancellation and keeps the stored id and rail', async () => {
    jest
      .mocked(addPiggyvestPrimarySavingsContribution)
      .mockRejectedValue(needsPin());
    const { params, contribution, key, operationRailRef, idempotencyKeyRef } =
      setup(jest.fn(async () => null));
    const error = await params
      ?.addSavingsContribution(contribution)
      .catch((e: unknown) => e);
    expect(isPinCancelled(error)).toBe(true);
    expect(addPiggyvestPrimarySavingsContribution).toHaveBeenCalledTimes(1);
    expect(idempotencyKeyRef.current).toBe(key);
    expect(operationRailRef.current).toBe('primary');
  });

  it('does not prompt when the server does not ask for a PIN', async () => {
    jest
      .mocked(addPiggyvestPrimarySavingsContribution)
      .mockResolvedValue({ status: 'pending', operationId: 'synthetic-key' });
    const ask = jest.fn(async () => proof);
    const { params, contribution } = setup(ask);
    await params?.addSavingsContribution(contribution);
    expect(ask).not.toHaveBeenCalled();
  });
});
