import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  custody: vi.fn(),
  interest: vi.fn(),
  bank: vi.fn(),
  inflow: vi.fn(),
}));
vi.mock('@/lib/piggyvest/primary-wallet-card-custody-intake-dispatch', () => ({
  dispatchPrimaryCardSignedCustodyIntake: mocks.custody,
}));
vi.mock('@/lib/piggyvest/primary-interest-webhook-response', () => ({
  primaryInterestWebhookResponse: mocks.interest,
}));
vi.mock('@/lib/piggyvest/primary-wallet-bank-inbox-intake', () => ({
  dispatchPrimaryWalletBankInboxIntake: mocks.bank,
}));
vi.mock('@/lib/piggyvest/primary-wallet-inflow-dispatch', () => ({
  dispatchPrimaryWalletInflow: mocks.inflow,
}));

import { dispatchPrimaryPiggyvestIntake } from './primary-webhook-dispatch';

const rawBody = Buffer.from('{}');
const base = {
  rawBody,
  signature: 'ab'.repeat(64),
  matchedSecret: 'fixture-secret',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.custody.mockResolvedValue({ response: null });
  mocks.interest.mockResolvedValue(null);
  mocks.bank.mockResolvedValue({ response: null });
  mocks.inflow.mockResolvedValue('ignored');
});

it.each([
  ['wallet-transfer.outflow.success', 'custody', mocks.custody],
  ['interest-payout.success', 'interest', mocks.interest],
  ['bank-transfer.inflow.success', 'bank', mocks.bank],
] as const)('forwards the replay key scope to the %s intake (%s)', async (eventType, family, intake) => {
  await dispatchPrimaryPiggyvestIntake({
    ...base,
    event: { eventType } as never,
    families: [family],
    keyScope: 'replay',
  });

  expect(intake).toHaveBeenCalledWith(
    expect.objectContaining({ keyScope: 'replay' })
  );
});

it.each([
  ['wallet-transfer.outflow.success', 'custody', mocks.custody],
  ['interest-payout.success', 'interest', mocks.interest],
  ['bank-transfer.inflow.success', 'bank', mocks.bank],
] as const)('leaves the %s intake on the ingress scope by default (%s)', async (eventType, family, intake) => {
  await dispatchPrimaryPiggyvestIntake({
    ...base,
    event: { eventType } as never,
    families: [family],
  });

  const forwarded = intake.mock.calls[0]?.[0];
  expect(forwarded.keyScope ?? 'ingress').toBe('ingress');
});

it('never consults a family intake for a key that belongs to another family', async () => {
  await dispatchPrimaryPiggyvestIntake({
    ...base,
    event: { eventType: 'bank-transfer.inflow.success' } as never,
    families: ['interest'],
    keyScope: 'replay',
  });
  expect(mocks.bank).not.toHaveBeenCalled();

  await dispatchPrimaryPiggyvestIntake({
    ...base,
    event: { eventType: 'interest-payout.success' } as never,
    families: ['bank'],
    keyScope: 'replay',
  });
  expect(mocks.interest).not.toHaveBeenCalled();

  await dispatchPrimaryPiggyvestIntake({
    ...base,
    event: { eventType: 'wallet-transfer.outflow.success' } as never,
    families: ['bank', 'interest'],
    keyScope: 'replay',
  });
  expect(mocks.custody).not.toHaveBeenCalled();
});
