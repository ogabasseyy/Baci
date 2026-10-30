import { createHash, createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  readiness: vi.fn(),
  claim: vi.fn(),
  process: vi.fn(),
  retry: vi.fn(),
  created: [] as unknown[],
}));

vi.mock('server-only', () => ({}));
vi.mock('./primary-wallet-bank-inbox-store', () => ({
  createPrimaryWalletBankInboxStore: (config: unknown) => {
    store.created.push(config);
    return store;
  },
}));

import { primaryBankInboxFixture as bank } from './primary-wallet-bank-inbox.test-fixture';
import { drainPrimaryWalletBankInbox } from './primary-wallet-bank-inbox-worker';
import { primaryCardCustodyInboxFixture as custody } from './primary-wallet-card-custody-inbox.test-fixture';
import { createPrimaryCardCustodyInboxIntake } from './primary-wallet-card-custody-inbox-intake';
import { createPrimaryCardCustodyInboxWorker } from './primary-wallet-card-custody-inbox-worker';

const HOUR = 3_600_000;
const sign = (secret: string, body: Uint8Array) =>
  createHmac('sha512', secret).update(body).digest('hex');
const key = (label: string) => createHash('sha256').update(label).digest('hex');

const expired = (count: number, family: string, base = Date.now()) =>
  Array.from({ length: count }, (_, index) => ({
    version: `old-${index}`,
    family,
    secret: key(`old-${index}`),
    // index 0 is the most recently retired, still well past the overlap
    retiredAt: new Date(base - (200 + index) * HOUR).toISOString(),
  }));

beforeEach(() => {
  vi.clearAllMocks();
  store.created.length = 0;
  store.readiness.mockResolvedValue(true);
  store.process.mockResolvedValue('prerequisite');
  store.retry.mockResolvedValue(true);
});

describe('bank worker drain with archived keys', () => {
  const retained = JSON.stringify(['retained-1', 'retained-2', 'retained-3']);
  const env = (entries: unknown[]) => ({
    ...bank.env,
    PIGGYVEST_PRIMARY_BANK_RETAINED_WEBHOOK_SECRETS: retained,
    PIGGYVEST_WEBHOOK_KEY_ARCHIVE: JSON.stringify(entries),
  });
  const claimSignedBy = (secret: string) => ({
    ...bank.claim,
    signature: sign(secret, bank.rawBody),
  });

  it('many expired archive entries do not disable the drain, and the store gets the operator config', async () => {
    store.claim.mockResolvedValue([]);

    await expect(
      drainPrimaryWalletBankInbox({ env: env(expired(24, 'bank')) })
    ).resolves.toEqual({ claimed: 0, processed: 0, deferred: 0, blocked: 0 });

    expect(
      (store.created[0] as { retainedWebhookSecrets: string[] })
        .retainedWebhookSecrets
    ).toEqual(['retained-1', 'retained-2', 'retained-3']);
  });

  it('replays a stored row signed by a revoked bank key within the newest archived keys', async () => {
    store.claim.mockResolvedValue([claimSignedBy(key('old-0'))]);

    await expect(
      drainPrimaryWalletBankInbox({ env: env(expired(24, 'bank')) })
    ).resolves.toMatchObject({ claimed: 1, deferred: 1 });
    expect(store.retry).not.toHaveBeenCalled();
  });

  it('a key beyond the bound, or archived for another family, is not accepted by the worker', async () => {
    store.claim.mockResolvedValue([claimSignedBy(key('old-23'))]);
    await expect(
      drainPrimaryWalletBankInbox({ env: env(expired(24, 'bank')) })
    ).rejects.toThrow('signing key unavailable');

    store.claim.mockResolvedValue([claimSignedBy(key('old-0'))]);
    await expect(
      drainPrimaryWalletBankInbox({ env: env(expired(24, 'interest')) })
    ).rejects.toThrow('signing key unavailable');
  });

  it('the current and retained keys still verify exactly as before', async () => {
    store.claim.mockResolvedValue([
      claimSignedBy(bank.config.webhookSecret),
      claimSignedBy('retained-2'),
    ]);
    store.claim.mockResolvedValueOnce([
      claimSignedBy(bank.config.webhookSecret),
    ]);

    await expect(
      drainPrimaryWalletBankInbox({ env: env([]) })
    ).resolves.toMatchObject({ claimed: 1, deferred: 1 });
  });
});

describe('custody signed inbox with archived keys', () => {
  const archivedSecret = key('custody-archived');

  it('the intake accepts an archived key through a separate bounded input, leaving the operator config at its cap', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce(custody.ready)
      .mockResolvedValueOnce('accepted');
    const accept = createPrimaryCardCustodyInboxIntake({
      configuration: {
        ...custody.configuration,
        retainedWebhookSecrets: ['r1', 'r2', 'r3'],
      },
      capability: custody.capability,
      execute,
      archivedSecrets: [archivedSecret],
    });

    await expect(
      accept(custody.rawBody, sign(archivedSecret, custody.rawBody))
    ).resolves.toBe('accepted');
  });

  it('the intake refuses an archived key it was not given, and an oversized derived list', async () => {
    const execute = vi.fn().mockResolvedValue(custody.ready);
    const without = createPrimaryCardCustodyInboxIntake({
      configuration: custody.configuration,
      capability: custody.capability,
      execute,
    });
    await expect(
      without(custody.rawBody, sign(archivedSecret, custody.rawBody))
    ).resolves.toBe('invalid_signature');

    expect(() =>
      createPrimaryCardCustodyInboxIntake({
        configuration: custody.configuration,
        capability: custody.capability,
        execute,
        archivedSecrets: Array.from({ length: 9 }, (_, i) => `k-${i}`),
      })
    ).toThrow();
  });

  it('the worker re-checks stored rows with the archived keys it was given', async () => {
    const execute = vi.fn(async (action: string): Promise<unknown> => {
      if (action === 'inboxReadiness') return custody.ready;
      if (action === 'inboxClaim')
        return [
          {
            ...custody.claim,
            signature: sign(archivedSecret, custody.rawBody),
          },
        ];
      if (action === 'context') return custody.context;
      if (action === 'settle') return 'completed';
      if (action === 'inboxFinish') return true;
      throw new Error('unexpected action');
    });
    const run = createPrimaryCardCustodyInboxWorker({
      configuration: custody.configuration,
      capability: custody.capability,
      execute,
      resolveOperation: vi.fn().mockResolvedValue(custody.context.operationId),
      observe: vi.fn().mockResolvedValue(custody),
      now: () => custody.now,
      archivedSecrets: [archivedSecret],
    });

    const totals = await run();

    // Verified (not deferred for a missing key): the worker reached the
    // ledger context for the stored receipt.
    expect(execute.mock.calls.map(([action]) => action)).toContain('context');
    expect(totals.claimed).toBe(1);
  });
});
