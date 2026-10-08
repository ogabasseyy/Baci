import { beforeEach, expect, it, vi } from 'vitest';
import { primaryBankInboxFixture as fixture } from './primary-wallet-bank-inbox.test-fixture';
import { drainPrimaryWalletBankInbox } from './primary-wallet-bank-inbox-worker';

const store = vi.hoisted(() => ({
  readiness: vi.fn(),
  claim: vi.fn(),
  process: vi.fn(),
  retry: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('./primary-wallet-bank-inbox-store', () => ({
  createPrimaryWalletBankInboxStore: () => store,
}));
beforeEach(() => {
  vi.clearAllMocks();
  store.readiness.mockResolvedValue(true);
  store.claim.mockResolvedValue([fixture.claim]);
  store.process.mockResolvedValue('prerequisite');
  store.retry.mockResolvedValue(true);
});
it('keeps bank-before-custody pending, then processes the exact signed receipt without guessing card attribution', async () => {
  expect(await drainPrimaryWalletBankInbox({ env: fixture.env })).toEqual({
    claimed: 1,
    processed: 0,
    deferred: 1,
    blocked: 0,
  });
  expect(store.process).toHaveBeenCalledWith(
    expect.objectContaining({
      eventId: fixture.event.eventId,
      receipt: expect.objectContaining({
        providerWalletId: 'owned-wallet',
        providerTransactionId: 'bank-transaction',
        bodyDigest: fixture.claim.bodyDigest,
      }),
    })
  );
  store.process.mockResolvedValue('duplicate');
  expect(
    (await drainPrimaryWalletBankInbox({ env: fixture.env })).processed
  ).toBe(1);
});
it('keeps genuine identity conflicts blocked rather than retrying them as custody prerequisites', async () => {
  store.process.mockResolvedValue('conflict');
  expect(
    (await drainPrimaryWalletBankInbox({ env: fixture.env })).blocked
  ).toBe(1);
});
it('does not process corrupted bytes or missing signing keys and retains the original record', async () => {
  store.claim.mockResolvedValue([
    { ...fixture.claim, bodyDigest: 'a'.repeat(64) },
  ]);
  expect(
    (await drainPrimaryWalletBankInbox({ env: fixture.env })).blocked
  ).toBe(1);
  expect(store.retry).toHaveBeenCalledWith(
    expect.objectContaining({ reason: 'invalid_receipt' })
  );
  store.claim.mockResolvedValue([fixture.claim]);
  await expect(
    drainPrimaryWalletBankInbox({
      env: {
        ...fixture.env,
        PIGGYVEST_PRIMARY_BANK_INBOX_WEBHOOK_SECRET: 'rotated-synthetic-key',
      },
    })
  ).rejects.toThrow('Primary bank receipt signing key unavailable');
  expect(store.retry).toHaveBeenLastCalledWith(
    expect.objectContaining({
      eventId: fixture.claim.eventId,
      reason: 'io_retry',
    })
  );
  expect(store.process).not.toHaveBeenCalled();
});
it('reverifies retained signing keys and propagates database or retry persistence failures', async () => {
  const env = {
    ...fixture.env,
    PIGGYVEST_PRIMARY_BANK_INBOX_WEBHOOK_SECRET: 'rotated-synthetic-key',
    PIGGYVEST_PRIMARY_BANK_RETAINED_WEBHOOK_SECRETS: JSON.stringify([
      fixture.config.webhookSecret,
    ]),
  };
  store.process.mockRejectedValue(new Error('raw database details'));
  await expect(drainPrimaryWalletBankInbox({ env })).rejects.toThrow(
    'processing unavailable'
  );
  expect(store.retry).toHaveBeenCalledWith(
    expect.objectContaining({ reason: 'io_retry' })
  );
  store.retry.mockRejectedValue(
    new Error('synthetic failed retry persistence')
  );
  await expect(drainPrimaryWalletBankInbox({ env })).rejects.toThrow(
    'failed retry persistence'
  );
});
it('bounds batches and leaves aborted claimed operations available for lease recovery', async () => {
  await expect(
    drainPrimaryWalletBankInbox({ env: fixture.env, batchSize: 11 })
  ).rejects.toThrow();
  const controller = new AbortController();
  controller.abort();
  expect(
    (
      await drainPrimaryWalletBankInbox({
        env: fixture.env,
        signal: controller.signal,
      })
    ).claimed
  ).toBe(0);
});
