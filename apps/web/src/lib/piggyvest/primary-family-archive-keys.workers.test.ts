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
import { verifyPiggyvestWebhookSecrets } from './webhook-secret-union';

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

  it('a full archive (8 keys for the family) does not disable the drain and the store gets the operator config', async () => {
    store.claim.mockResolvedValue([]);

    await expect(
      drainPrimaryWalletBankInbox({ env: env(expired(8, 'bank')) })
    ).resolves.toEqual({ claimed: 0, processed: 0, deferred: 0, blocked: 0 });

    expect(
      (store.created[0] as { retainedWebhookSecrets: string[] })
        .retainedWebhookSecrets
    ).toEqual(['retained-1', 'retained-2', 'retained-3']);
  });

  it('accepts exactly the same keys as ingress: every one of the 8, including the oldest', async () => {
    const entries = expired(8, 'bank');
    for (const index of [0, 7]) {
      store.claim.mockResolvedValue([claimSignedBy(key(`old-${index}`))]);
      await expect(
        drainPrimaryWalletBankInbox({ env: env(entries) })
      ).resolves.toMatchObject({ claimed: 1, deferred: 1 });
    }
    expect(store.retry).not.toHaveBeenCalled();
  });

  it('an accepted receipt stays drainable after one more rotation within the cap', async () => {
    const seven = [
      {
        version: 'recent',
        family: 'bank',
        secret: key('recent'),
        retiredAt: new Date(Date.now() - HOUR).toISOString(),
      },
      ...expired(6, 'bank'),
    ];
    // Accepted at ingress while inside its overlap...
    expect(
      verifyPiggyvestWebhookSecrets({
        rawBody: bank.rawBody,
        signature: sign(key('recent'), bank.rawBody),
        env: env(seven),
      })
    ).toMatchObject({ status: 'verified', keyStatus: 'overlap' });

    // ...then the operator rotates once more (7 -> 8 entries, still in cap).
    const eight = [
      ...seven,
      {
        version: 'newest',
        family: 'bank',
        secret: key('newest'),
        retiredAt: new Date(Date.now() - 30 * 60_000).toISOString(),
      },
    ];
    store.claim.mockResolvedValue([claimSignedBy(key('recent'))]);
    await expect(
      drainPrimaryWalletBankInbox({ env: env(eight) })
    ).resolves.toMatchObject({ claimed: 1, deferred: 1 });
  });

  it('a 9th entry for the family rejects the archive everywhere: ingress never trusts it and the worker adds nothing', async () => {
    const nine = expired(9, 'bank');
    expect(
      verifyPiggyvestWebhookSecrets({
        rawBody: bank.rawBody,
        signature: sign(key('old-0'), bank.rawBody),
        env: env(nine),
      })
    ).toEqual({ status: 'unconfigured' });

    // Current and retained keys keep draining; archive keys are refused.
    store.claim.mockResolvedValue([claimSignedBy('retained-2')]);
    await expect(
      drainPrimaryWalletBankInbox({ env: env(nine) })
    ).resolves.toMatchObject({ claimed: 1, deferred: 1 });
    store.claim.mockResolvedValue([claimSignedBy(key('old-0'))]);
    await expect(
      drainPrimaryWalletBankInbox({ env: env(nine) })
    ).rejects.toThrow('signing key unavailable');
  });

  it('a key archived for another family is not accepted by the bank worker', async () => {
    store.claim.mockResolvedValue([claimSignedBy(key('old-0'))]);
    await expect(
      drainPrimaryWalletBankInbox({ env: env(expired(8, 'interest')) })
    ).rejects.toThrow('signing key unavailable');
  });

  it('the current and retained keys still verify exactly as before', async () => {
    store.claim.mockResolvedValue([claimSignedBy(bank.config.webhookSecret)]);

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
