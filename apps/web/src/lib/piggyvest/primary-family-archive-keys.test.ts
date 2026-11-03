import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { primaryBankInboxFixture as bank } from './primary-wallet-bank-inbox.test-fixture';
import { readPrimaryWalletBankInboxRuntime } from './primary-wallet-bank-inbox-runtime';
import { createPrimaryWalletBankInboxStore } from './primary-wallet-bank-inbox-store';
import { primaryCardCustodyInboxFixture as custody } from './primary-wallet-card-custody-inbox.test-fixture';
import { createPrimaryCardCustodyInboxIntake } from './primary-wallet-card-custody-inbox-intake';
import { readPrimaryCardCustodyInboxRuntime } from './primary-wallet-card-custody-inbox-runtime';
import { readPrimaryCardCustodyIntakeRuntime } from './primary-wallet-card-custody-intake-runtime';
import { paidInterestFixture as interest } from './primary-wallet-paid-interest.test-support';
import { readPrimaryWalletPaidInterestInboxRuntime } from './primary-wallet-paid-interest-inbox-runtime';
import { createPrimaryWalletPaidInterestInboxStore } from './primary-wallet-paid-interest-inbox-store';
import { readPrimaryWalletPaidInterestRuntime } from './primary-wallet-paid-interest-runtime';

/**
 * The operator-configured retained keys are validated with the family's
 * schema caps (3 for bank and custody, 4 for interest) by the runtime
 * readers AND again by every downstream constructor. Archived keys must
 * never be folded into that list: a full retained list plus one archived
 * key would otherwise fail the constructors' re-parse and disable intake
 * and the drain even for current-key deliveries.
 */

const HOUR = 3_600_000;
const iso = (hoursAgo: number, base = Date.now()) =>
  new Date(base - hoursAgo * HOUR).toISOString();

function archive(family: string, base = Date.now()) {
  return JSON.stringify([
    {
      version: 'k-overlap',
      family,
      secret: 'archived-overlap-secret',
      retiredAt: iso(2, base),
    },
    {
      version: 'k-revoked',
      family,
      secret: 'archived-revoked-secret',
      retiredAt: iso(200, base),
    },
  ]);
}

const retained = (count: number) =>
  JSON.stringify(
    Array.from({ length: count }, (_, index) => `retained-${index + 1}`)
  );

const interestEnv = {
  NODE_ENV: 'test' as const,
  VERCEL_ENV: 'production',
  PIGGYVEST_PRIMARY_PAID_INTEREST_ENABLED: 'true',
  PIGGYVEST_PRIMARY_PAID_INTEREST_INBOX_ENABLED: 'true',
  PIGGYVEST_PRIMARY_PAID_INTEREST_INBOX_DRAIN_SCHEDULED: 'true',
  PIGGYVEST_PRIMARY_INTEGRATION_ID: interest.config.integrationId,
  PIGGYVEST_PRIMARY_ENVIRONMENT: 'production',
  PIGGYVEST_PRIMARY_PAID_INTEREST_BUSINESS_ID: interest.config.businessId,
  PIGGYVEST_PRIMARY_PAID_INTEREST_API_TOKEN: interest.config.providerToken,
  PIGGYVEST_PRIMARY_PAID_INTEREST_WEBHOOK_SECRET: interest.config.webhookSecret,
  PIGGYVEST_PRIMARY_DB_HOST: interest.config.database.host,
  PIGGYVEST_PRIMARY_DB_PORT: '5432',
  PIGGYVEST_PRIMARY_DB_NAME: 'postgres',
  PIGGYVEST_PRIMARY_EVIDENCE_DB_PASSWORD: interest.config.database.password,
  PIGGYVEST_PRIMARY_DB_CA: interest.config.database.certificateAuthority,
};

describe('bank family at the retained-key cap', () => {
  const env = {
    ...bank.env,
    PIGGYVEST_PRIMARY_BANK_RETAINED_WEBHOOK_SECRETS: retained(3),
    PIGGYVEST_WEBHOOK_KEY_ARCHIVE: archive('bank'),
  };

  it.each([
    'intake',
    'worker',
  ] as const)('the %s runtime returns exactly the operator retained list', (mode) => {
    const config = readPrimaryWalletBankInboxRuntime(mode, env);
    expect(config?.retainedWebhookSecrets).toEqual([
      'retained-1',
      'retained-2',
      'retained-3',
    ]);
    expect(config?.webhookSecret).toBe(bank.config.webhookSecret);
  });

  it('the downstream store constructor still accepts the runtime config', () => {
    for (const mode of ['intake', 'worker'] as const) {
      const config = readPrimaryWalletBankInboxRuntime(mode, env);
      expect(() => createPrimaryWalletBankInboxStore(config)).not.toThrow();
    }
  });
});

describe('interest family at the retained-key cap', () => {
  const env = {
    ...interestEnv,
    PIGGYVEST_PRIMARY_PAID_INTEREST_RETAINED_WEBHOOK_SECRETS: retained(4),
    PIGGYVEST_WEBHOOK_KEY_ARCHIVE: archive('interest'),
  };

  it('inbox and direct runtimes return exactly the operator retained list', () => {
    const expected = ['retained-1', 'retained-2', 'retained-3', 'retained-4'];
    for (const mode of ['intake', 'worker'] as const) {
      expect(
        readPrimaryWalletPaidInterestInboxRuntime(mode, env)
          ?.retainedWebhookSecrets
      ).toEqual(expected);
    }
    for (const mode of ['intake', 'drain'] as const) {
      expect(
        readPrimaryWalletPaidInterestRuntime(env, mode)?.retainedWebhookSecrets
      ).toEqual(expected);
    }
  });

  it('the downstream store constructor still accepts the runtime config', () => {
    for (const mode of ['intake', 'worker'] as const) {
      const config = readPrimaryWalletPaidInterestInboxRuntime(mode, env);
      expect(() =>
        createPrimaryWalletPaidInterestInboxStore(config)
      ).not.toThrow();
    }
  });
});

describe('custody family at the retained-key cap', () => {
  const env = {
    ...custody.environment,
    PIGGYVEST_PRIMARY_CARD_RETAINED_PIGGYVEST_WEBHOOK_SECRETS: retained(3),
    PIGGYVEST_WEBHOOK_KEY_ARCHIVE: archive('custody', custody.now),
  };

  it('intake and inbox runtimes return exactly the operator retained list', () => {
    const expected = ['retained-1', 'retained-2', 'retained-3'];
    expect(
      readPrimaryCardCustodyIntakeRuntime(env, custody.now)
        ?.retainedWebhookSecrets
    ).toEqual(expected);
    for (const mode of ['intake', 'drain'] as const) {
      expect(
        readPrimaryCardCustodyInboxRuntime(env, custody.now, mode)
          ?.retainedWebhookSecrets
      ).toEqual(expected);
    }
  });

  it('the downstream intake constructor still accepts the runtime config', () => {
    const config = readPrimaryCardCustodyIntakeRuntime(env, custody.now);
    expect(() =>
      createPrimaryCardCustodyInboxIntake({
        configuration: config,
        capability: custody.capability,
        execute: vi.fn(),
      })
    ).not.toThrow();
  });
});
