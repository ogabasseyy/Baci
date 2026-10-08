import { createHash, createHmac } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
import { paidInterestFixture as fixture } from './primary-wallet-paid-interest.test-support';
import { drainPrimaryWalletPaidInterestInbox } from './primary-wallet-paid-interest-inbox-worker';

const mocks = vi.hoisted(() => ({
  runtime: vi.fn(),
  claim: vi.fn(),
  finish: vi.fn(),
  dispatch: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('./primary-wallet-paid-interest-inbox-runtime', () => ({
  readPrimaryWalletPaidInterestInboxRuntime: mocks.runtime,
}));
vi.mock('./primary-wallet-paid-interest-inbox-store', () => ({
  createPrimaryWalletPaidInterestInboxStore: () => ({
    claim: mocks.claim,
    finish: mocks.finish,
  }),
}));
vi.mock('./primary-wallet-paid-interest-dispatch', () => ({
  dispatchPrimaryWalletPaidInterest: mocks.dispatch,
}));
const rawBody = Buffer.from(JSON.stringify(fixture.event));
const claim = {
  eventId: fixture.event.eventId,
  token: fixture.config.integrationId,
  rawHex: rawBody.toString('hex'),
  bodyDigest: createHash('sha256').update(rawBody).digest('hex'),
  signature: createHmac('sha512', fixture.config.webhookSecret)
    .update(rawBody)
    .digest('hex'),
  attempts: 1,
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.runtime.mockReturnValue(fixture.config);
  mocks.claim.mockResolvedValue([claim]);
  mocks.finish.mockResolvedValue(true);
  mocks.dispatch.mockResolvedValue('credited');
});
it.each([
  'credited',
  'duplicate',
])('finishes %s only after reverified existing bridge dispatch', async (outcome) => {
  mocks.dispatch.mockResolvedValue(outcome);
  expect((await drainPrimaryWalletPaidInterestInbox({})).processed).toBe(1);
  expect(mocks.dispatch).toHaveBeenCalledWith(
    expect.objectContaining({ rawBody, signature: claim.signature })
  );
  expect(mocks.finish).toHaveBeenCalledWith({
    eventId: claim.eventId,
    token: claim.token,
    outcome,
  });
});
it.each([
  'prerequisite',
  'disabled',
])('defers %s without marking money processed', async (outcome) => {
  mocks.dispatch.mockResolvedValue(outcome);
  expect((await drainPrimaryWalletPaidInterestInbox({})).deferred).toBe(1);
  expect(mocks.finish).toHaveBeenCalledWith(
    expect.objectContaining({ outcome: 'prerequisite' })
  );
});
it('durably quarantines financial conflict', async () => {
  mocks.dispatch.mockResolvedValue('conflict');
  expect((await drainPrimaryWalletPaidInterestInbox({})).quarantined).toBe(1);
  expect(mocks.finish).toHaveBeenCalledWith(
    expect.objectContaining({ outcome: 'conflict' })
  );
});
it('retries provider or database I/O rather than claiming completion', async () => {
  mocks.dispatch.mockRejectedValue(new Error('secret provider failure'));
  await expect(drainPrimaryWalletPaidInterestInbox({})).rejects.toThrow(
    'Primary interest inbox worker unavailable'
  );
  expect(mocks.finish).toHaveBeenCalledWith(
    expect.objectContaining({ outcome: 'io_retry' })
  );
});
it('preserves missing historical signing key as retry without blind credit', async () => {
  mocks.claim.mockResolvedValue([{ ...claim, signature: 'a'.repeat(128) }]);
  await expect(drainPrimaryWalletPaidInterestInbox({})).rejects.toThrow(
    'Primary interest inbox worker unavailable'
  );
  expect(mocks.dispatch).not.toHaveBeenCalled();
});
it('reports redacted operational failure when provider I/O and durable retry finish both fail', async () => {
  mocks.dispatch.mockRejectedValue(new Error('secret provider failure'));
  mocks.finish.mockRejectedValue(new Error('secret database finish failure'));
  await expect(drainPrimaryWalletPaidInterestInbox({})).rejects.toThrow(
    'Primary interest inbox worker unavailable'
  );
  expect(mocks.finish).toHaveBeenCalledWith(
    expect.objectContaining({ outcome: 'io_retry' })
  );
  expect(mocks.dispatch).toHaveBeenCalledOnce();
});
it('reverifies frozen queued bytes with a retained key and passes only that server-configured key to the bridge', async () => {
  mocks.runtime.mockReturnValue({
    ...fixture.config,
    webhookSecret: 'new-test-only-key',
    retainedWebhookSecrets: [fixture.config.webhookSecret],
  });
  expect(
    (await drainPrimaryWalletPaidInterestInbox({ env: { NODE_ENV: 'test' } }))
      .processed
  ).toBe(1);
  expect(mocks.dispatch).toHaveBeenCalledWith(
    expect.objectContaining({
      env: expect.objectContaining({
        PIGGYVEST_PRIMARY_PAID_INTEREST_WEBHOOK_SECRET:
          fixture.config.webhookSecret,
      }),
    })
  );
});
it('quarantines changed bytes or event identity before bridge dispatch', async () => {
  for (const changed of [
    { ...claim, bodyDigest: 'a'.repeat(64) },
    { ...claim, eventId: 'different' },
  ]) {
    mocks.claim.mockResolvedValue([changed]);
    expect((await drainPrimaryWalletPaidInterestInbox({})).quarantined).toBe(1);
  }
  expect(mocks.dispatch).not.toHaveBeenCalled();
});
it('does not report processed when finish loses its lease or acknowledgement', async () => {
  mocks.finish.mockResolvedValue(false);
  await expect(drainPrimaryWalletPaidInterestInbox({})).rejects.toThrow();
});
it('does not duplicate work from invalid duplicate claim IDs', async () => {
  mocks.claim.mockResolvedValue([claim, claim]);
  await expect(drainPrimaryWalletPaidInterestInbox({})).rejects.toThrow(
    'claims unavailable'
  );
  expect(mocks.dispatch).not.toHaveBeenCalled();
});
it('does no work when disabled or cancelled', async () => {
  await drainPrimaryWalletPaidInterestInbox({ signal: AbortSignal.abort() });
  mocks.runtime.mockReturnValue(null);
  await drainPrimaryWalletPaidInterestInbox({});
  expect(mocks.claim).not.toHaveBeenCalled();
});
