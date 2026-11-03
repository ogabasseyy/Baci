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

const base = {
  rawBody: Buffer.from('{}'),
  signature: '0'.repeat(128),
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
  ['bank-transfer.inflow.success', ['legacy']],
  ['bank-transfer.inflow.success', ['legacy', 'bank']],
  ['wallet-transfer.outflow.success', ['custody']],
  ['wallet-transfer.outflow.success', ['legacy', 'custody']],
  ['interest-payout.success', ['legacy', 'interest']],
] as const)('defers a %s delivery with a retryable 503 while the kill switch is on (%j)', async (eventType, families) => {
  vi.stubEnv('PIGGYVEST_KILL_SWITCH', 'true');
  try {
    const response = await dispatchPrimaryPiggyvestIntake({
      ...base,
      event: { eventType } as never,
      families: [...families],
    });
    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(503);
    expect(await (response as Response).json()).toMatchObject({
      received: false,
      code: 'PIGGYVEST_KILL_SWITCH_ACTIVE',
    });
    expect(mocks.custody).not.toHaveBeenCalled();
    expect(mocks.interest).not.toHaveBeenCalled();
    expect(mocks.bank).not.toHaveBeenCalled();
    expect(mocks.inflow).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllEnvs();
  }
});

it('keeps reconciling a legacy-signed outflow notice for an existing transfer while killed', async () => {
  vi.stubEnv('PIGGYVEST_KILL_SWITCH', 'true');
  try {
    const response = await dispatchPrimaryPiggyvestIntake({
      ...base,
      event: { eventType: 'wallet-transfer.outflow.success' } as never,
      families: ['legacy'],
    });
    expect(response).toBeNull();
  } finally {
    vi.unstubAllEnvs();
  }
});

it('lets the same legacy-signed inflow through to the legacy path once the switch is lifted', async () => {
  vi.stubEnv('PIGGYVEST_KILL_SWITCH', 'false');
  try {
    const response = await dispatchPrimaryPiggyvestIntake({
      ...base,
      event: { eventType: 'bank-transfer.inflow.success' } as never,
      families: ['legacy'],
    });
    expect(response).toBeNull();
  } finally {
    vi.unstubAllEnvs();
  }
});
