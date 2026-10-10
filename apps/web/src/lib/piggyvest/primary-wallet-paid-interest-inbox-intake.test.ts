import { createHmac } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
import { paidInterestFixture as fixture } from './primary-wallet-paid-interest.test-support';
import { dispatchPrimaryWalletPaidInterestInbox } from './primary-wallet-paid-interest-inbox-intake';

const mocks = vi.hoisted(() => ({ runtime: vi.fn(), enqueue: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('./primary-wallet-paid-interest-inbox-runtime', () => ({
  readPrimaryWalletPaidInterestInboxRuntime: mocks.runtime,
}));
vi.mock('./primary-wallet-paid-interest-inbox-store', () => ({
  createPrimaryWalletPaidInterestInboxStore: () => ({ enqueue: mocks.enqueue }),
}));
const rawBody = Buffer.from(`  ${JSON.stringify(fixture.event)}\n`);
const signature = createHmac('sha512', fixture.config.webhookSecret)
  .update(rawBody)
  .digest('hex');
beforeEach(() => {
  vi.clearAllMocks();
  mocks.runtime.mockReturnValue(fixture.config);
  mocks.enqueue.mockResolvedValue('accepted');
});
it('persists exact signed whitespace-preserving bytes before acknowledging', async () => {
  expect(
    await dispatchPrimaryWalletPaidInterestInbox({ rawBody, signature })
  ).toBe('accepted');
  expect(mocks.enqueue).toHaveBeenCalledWith({
    rawHex: rawBody.toString('hex'),
    signature,
  });
});
it('does not acknowledge when durable persistence fails', async () => {
  mocks.enqueue.mockRejectedValue(
    new Error('Primary interest inbox database unavailable')
  );
  await expect(
    dispatchPrimaryWalletPaidInterestInbox({ rawBody, signature })
  ).rejects.toThrow('database unavailable');
});
it.each([
  'duplicate',
  'quarantined',
])('reports durable %s without financial credit', async (outcome) => {
  mocks.enqueue.mockResolvedValue(outcome);
  expect(
    await dispatchPrimaryWalletPaidInterestInbox({ rawBody, signature })
  ).toBe(outcome);
});
it('does not persist invalid HMAC, reserialized bytes or oversize input', async () => {
  for (const body of [
    Buffer.from(JSON.stringify(fixture.event)),
    Buffer.alloc(65537),
  ])
    expect(
      await dispatchPrimaryWalletPaidInterestInbox({ rawBody: body, signature })
    ).toBe('invalid_signature');
  expect(
    await dispatchPrimaryWalletPaidInterestInbox({ rawBody, signature: null })
  ).toBe('invalid_signature');
  expect(mocks.enqueue).not.toHaveBeenCalled();
});
it.each([
  ['empty object', '{}'],
  [
    'wrong event type',
    '{"eventType":"other","eventCategory":"interest-payout","eventId":"e1"}',
  ],
  [
    'missing event id',
    '{"eventType":"interest-payout.success","eventCategory":"interest-payout"}',
  ],
  ['not JSON', 'not-json'],
])('does not persist signed %s without an identifiable envelope', async (_label, text) => {
  const body = Buffer.from(text);
  const signed = createHmac('sha512', fixture.config.webhookSecret)
    .update(body)
    .digest('hex');
  expect(
    await dispatchPrimaryWalletPaidInterestInbox({
      rawBody: body,
      signature: signed,
    })
  ).toBe('invalid_payload');
  expect(mocks.enqueue).not.toHaveBeenCalled();
});
it('persists authenticated shape failures for durable worker quarantine', async () => {
  const body = Buffer.from(
    JSON.stringify({
      ...fixture.event,
      eventData: { ...fixture.event.eventData, currency: 'USD' },
    })
  );
  const signed = createHmac('sha512', fixture.config.webhookSecret)
    .update(body)
    .digest('hex');
  expect(
    await dispatchPrimaryWalletPaidInterestInbox({
      rawBody: body,
      signature: signed,
    })
  ).toBe('accepted');
  expect(mocks.enqueue).toHaveBeenCalledWith({
    rawHex: body.toString('hex'),
    signature: signed,
  });
});
it('persists signed inconsistent economics for durable worker quarantine', async () => {
  const body = Buffer.from(
    JSON.stringify({
      ...fixture.event,
      eventData: { ...fixture.event.eventData, amount: 3001 },
    })
  );
  const signed = createHmac('sha512', fixture.config.webhookSecret)
    .update(body)
    .digest('hex');
  expect(
    await dispatchPrimaryWalletPaidInterestInbox({
      rawBody: body,
      signature: signed,
    })
  ).toBe('accepted');
});
it('keeps disabled legacy routing distinct from acknowledged receipt', async () => {
  mocks.runtime.mockReturnValue(null);
  expect(
    await dispatchPrimaryWalletPaidInterestInbox({ rawBody, signature })
  ).toBe('disabled');
  expect(mocks.enqueue).not.toHaveBeenCalled();
});
it('accepts a configured retained signing key during approved key rotation', async () => {
  mocks.runtime.mockReturnValue({
    ...fixture.config,
    webhookSecret: 'new-test-only-key',
    retainedWebhookSecrets: [fixture.config.webhookSecret],
  });
  expect(
    await dispatchPrimaryWalletPaidInterestInbox({ rawBody, signature })
  ).toBe('accepted');
});
