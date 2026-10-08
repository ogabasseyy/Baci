import { beforeEach, expect, it, vi } from 'vitest';
import { primaryBankInboxFixture as fixture } from './primary-wallet-bank-inbox.test-fixture';
import { dispatchPrimaryWalletBankInboxIntake } from './primary-wallet-bank-inbox-intake';

const mocks = vi.hoisted(() => ({
  readiness: vi.fn(),
  enqueue: vi.fn(),
  create: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('./primary-wallet-bank-inbox-store', () => ({
  createPrimaryWalletBankInboxStore: mocks.create,
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.readiness.mockResolvedValue(true);
  mocks.enqueue.mockResolvedValue('accepted');
  mocks.create.mockReturnValue({
    readiness: mocks.readiness,
    enqueue: mocks.enqueue,
  });
});
it('preserves old-deployment legacy continuation without a new secret or database call', async () => {
  const result = await dispatchPrimaryWalletBankInboxIntake({
    rawBody: fixture.rawBody,
    signature: fixture.signature,
    env: { NODE_ENV: 'test' },
  });
  expect(result).toEqual({ outcome: 'disabled', response: null });
  expect(mocks.create).not.toHaveBeenCalled();
});
it.each([
  'accepted',
  'duplicate',
  'conflict',
] as const)('acknowledges %s only after exact raw-byte durable storage', async (outcome) => {
  mocks.enqueue.mockResolvedValue(outcome);
  const result = await dispatchPrimaryWalletBankInboxIntake({
    ...fixture,
    env: fixture.env,
  });
  expect(result.response?.status).toBe(200);
  expect(mocks.enqueue).toHaveBeenCalledWith({
    rawHex: fixture.rawBody.toString('hex'),
    signature: fixture.signature,
  });
  expect(JSON.stringify(await result.response?.json())).not.toContain(
    'Synthetic sender'
  );
});
it('accepts a retained bank key during rotation without queueing twice', async () => {
  const result = await dispatchPrimaryWalletBankInboxIntake({
    rawBody: fixture.rawBody,
    signature: fixture.signature,
    env: {
      ...fixture.env,
      PIGGYVEST_PRIMARY_BANK_INBOX_WEBHOOK_SECRET: 'rotated-bank-key',
      PIGGYVEST_PRIMARY_BANK_RETAINED_WEBHOOK_SECRETS: JSON.stringify([
        fixture.config.webhookSecret,
      ]),
    },
  });
  expect(result.outcome).toBe('accepted');
  expect(result.response?.status).toBe(200);
  expect(mocks.enqueue).toHaveBeenCalledTimes(1);
});
it('allows unrelated legacy inflows only after authoritative ownership lookup says not_handled', async () => {
  mocks.enqueue.mockResolvedValue('not_handled');
  expect(
    await dispatchPrimaryWalletBankInboxIntake({ ...fixture, env: fixture.env })
  ).toEqual({ outcome: 'not_handled', response: null });
});
it.each([
  'signature',
  'configuration',
  'storage',
  'payload',
] as const)('returns retryable failure, never unrecorded 200, for %s', async (fault) => {
  if (fault === 'storage')
    mocks.enqueue.mockRejectedValue(new Error('private raw response'));
  const result = await dispatchPrimaryWalletBankInboxIntake({
    rawBody: fault === 'payload' ? Buffer.from('{}') : fixture.rawBody,
    signature: fault === 'signature' ? 'bad' : fixture.signature,
    env:
      fault === 'configuration'
        ? { NODE_ENV: 'test', PIGGYVEST_PRIMARY_BANK_INBOX_ENABLED: 'true' }
        : fixture.env,
  });
  expect(result.response?.status).toBe(503);
  expect(JSON.stringify(await result.response?.json())).not.toContain(
    'private'
  );
});
