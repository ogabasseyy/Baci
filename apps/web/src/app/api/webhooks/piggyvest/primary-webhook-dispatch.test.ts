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

it('claims a custody-signed outflow through the custody intake', async () => {
  const claimed = new Response('{}', { status: 200 });
  mocks.custody.mockResolvedValue({ response: claimed });
  const response = await dispatchPrimaryPiggyvestIntake({
    ...base,
    event: { eventType: 'wallet-transfer.outflow.success' } as never,
    families: ['legacy', 'custody'],
  });
  expect(response).toBe(claimed);
  expect(mocks.custody).toHaveBeenCalledWith({
    rawBody,
    signature: base.signature,
  });
});

it('skips the custody intake for a legacy-signed outflow', async () => {
  const response = await dispatchPrimaryPiggyvestIntake({
    ...base,
    event: { eventType: 'wallet-transfer.outflow.success' } as never,
    families: ['legacy'],
  });
  expect(response).toBeNull();
  expect(mocks.custody).not.toHaveBeenCalled();
});

it('claims an interest-signed payout through the interest intake', async () => {
  const claimed = new Response('{}', { status: 200 });
  mocks.interest.mockResolvedValue(claimed);
  const response = await dispatchPrimaryPiggyvestIntake({
    ...base,
    event: { eventType: 'interest-payout.success' } as never,
    families: ['legacy', 'interest'],
  });
  expect(response).toBe(claimed);
});

it('skips the interest intake for a legacy-signed payout', async () => {
  const response = await dispatchPrimaryPiggyvestIntake({
    ...base,
    event: { eventType: 'interest-payout.success' } as never,
    families: ['legacy'],
  });
  expect(response).toBeNull();
  expect(mocks.interest).not.toHaveBeenCalled();
});

it('claims a bank-signed inflow through the bank intake', async () => {
  const claimed = new Response('{}', { status: 200 });
  mocks.bank.mockResolvedValue({ response: claimed });
  const response = await dispatchPrimaryPiggyvestIntake({
    ...base,
    event: { eventType: 'bank-transfer.inflow.success' } as never,
    families: ['legacy', 'bank'],
  });
  expect(response).toBe(claimed);
  expect(mocks.inflow).not.toHaveBeenCalled();
});

it('falls through to the shared inflow dispatcher when the bank intake declines', async () => {
  mocks.inflow.mockResolvedValue('credited');
  const response = await dispatchPrimaryPiggyvestIntake({
    ...base,
    event: { eventType: 'bank-transfer.inflow.success' } as never,
    families: ['legacy', 'bank'],
  });
  expect(response).toBeInstanceOf(Response);
  expect((response as Response).status).toBe(200);
  expect(await (response as Response).json()).toEqual({
    received: true,
    duplicate: false,
  });
  expect(mocks.inflow).toHaveBeenCalledWith({
    rawBody,
    signature: base.signature,
    secret: 'fixture-secret',
    families: ['legacy', 'bank'],
  });
});

it('acknowledges a duplicate inflow without re-crediting', async () => {
  mocks.inflow.mockResolvedValue('duplicate');
  const response = await dispatchPrimaryPiggyvestIntake({
    ...base,
    event: { eventType: 'bank-transfer.inflow.success' } as never,
    families: ['legacy'],
  });
  expect(response).toBeInstanceOf(Response);
  expect(await (response as Response).json()).toEqual({
    received: true,
    duplicate: true,
  });
  expect(mocks.bank).not.toHaveBeenCalled();
});

it('surfaces an inflow conflict for route-side quarantine', async () => {
  mocks.inflow.mockResolvedValue('conflict');
  const response = await dispatchPrimaryPiggyvestIntake({
    ...base,
    event: { eventType: 'bank-transfer.inflow.success' } as never,
    families: ['legacy'],
  });
  expect(response).toBe('conflict');
});

it('returns null for events no primary intake owns', async () => {
  const response = await dispatchPrimaryPiggyvestIntake({
    ...base,
    event: { eventType: 'restriction-created.success' } as never,
    families: ['legacy'],
  });
  expect(response).toBeNull();
  expect(mocks.custody).not.toHaveBeenCalled();
  expect(mocks.interest).not.toHaveBeenCalled();
  expect(mocks.bank).not.toHaveBeenCalled();
  expect(mocks.inflow).not.toHaveBeenCalled();
});
