import { beforeEach, expect, it, vi } from 'vitest';
import { schemaValidInflow } from '@/lib/piggyvest/webhook-capture-drain.test-support';
import { piggyvestWebhookEventSchema } from '@/schemas/piggyvest/events';

vi.mock('server-only', () => ({}));

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

const bankEvent = piggyvestWebhookEventSchema.parse(
  JSON.parse(schemaValidInflow('env-fixture', 'bank-transfer.inflow.success'))
);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.custody.mockResolvedValue({ response: null });
  mocks.interest.mockResolvedValue(null);
  mocks.bank.mockResolvedValue({ response: null });
  mocks.inflow.mockResolvedValue('ignored');
});

it('uses the supplied kill switch environment and forwards it to every bank money-in reader', async () => {
  vi.stubEnv('PIGGYVEST_KILL_SWITCH', 'true');
  try {
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: 'test',
      PIGGYVEST_KILL_SWITCH: 'false',
    };
    const response = await dispatchPrimaryPiggyvestIntake({
      rawBody: Buffer.from('{}'),
      signature: 'sig',
      matchedSecret: 'secret',
      event: bankEvent,
      families: ['bank'],
      env,
    });
    expect(response).toBeNull();
    expect(mocks.bank).toHaveBeenCalledWith(expect.objectContaining({ env }));
    expect(mocks.inflow).toHaveBeenCalledWith(expect.objectContaining({ env }));
  } finally {
    vi.unstubAllEnvs();
  }
});

it('blocks on the supplied kill switch environment even when process.env allows intake', async () => {
  vi.stubEnv('PIGGYVEST_KILL_SWITCH', 'false');
  try {
    const response = await dispatchPrimaryPiggyvestIntake({
      rawBody: Buffer.from('{}'),
      signature: 'sig',
      matchedSecret: 'secret',
      event: bankEvent,
      families: ['legacy'],
      env: { NODE_ENV: 'test', PIGGYVEST_KILL_SWITCH: 'true' },
    });
    expect(response).toBeInstanceOf(Response);
    if (!(response instanceof Response)) throw new Error('Expected a response');
    expect(response.status).toBe(503);
    expect(mocks.bank).not.toHaveBeenCalled();
    expect(mocks.inflow).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllEnvs();
  }
});
