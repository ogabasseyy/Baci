import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { primaryBankInboxFixture as bank } from './primary-wallet-bank-inbox.test-fixture';
import { readPrimaryWalletBankInboxRuntime } from './primary-wallet-bank-inbox-runtime';
import { primaryCardCustodyInboxFixture as custody } from './primary-wallet-card-custody-inbox.test-fixture';
import { readPrimaryCardCustodyInboxRuntime } from './primary-wallet-card-custody-inbox-runtime';
import { readPrimaryCardCustodyIntakeRuntime } from './primary-wallet-card-custody-intake-runtime';
import { paidInterestFixture as interest } from './primary-wallet-paid-interest.test-support';
import { readPrimaryWalletPaidInterestInboxRuntime } from './primary-wallet-paid-interest-inbox-runtime';
import { readPrimaryWalletPaidInterestRuntime } from './primary-wallet-paid-interest-runtime';

/**
 * A key moved into PIGGYVEST_WEBHOOK_KEY_ARCHIVE at rotation must keep
 * working for the family it was issued for, and only that family, through
 * the family's own re-verification (the intakes and the workers read these
 * runtimes). Inside the overlap it authorises new deliveries; past the
 * overlap it only re-checks bodies already stored.
 */

const HOUR = 3_600_000;
const iso = (hoursAgo: number, base = Date.now()) =>
  new Date(base - hoursAgo * HOUR).toISOString();

const KEYS = {
  overlap: 'archived-overlap-secret',
  revoked: 'archived-revoked-secret',
  foreign: 'archived-foreign-family-secret',
};

// `base` is the clock the reader under test uses: custody readers take the
// caller's `now`, the others use the real clock.
function archive(family: string, foreignFamily: string, base = Date.now()) {
  return JSON.stringify([
    {
      version: 'k-overlap',
      family,
      secret: KEYS.overlap,
      retiredAt: iso(2, base),
    },
    {
      version: 'k-revoked',
      family,
      secret: KEYS.revoked,
      retiredAt: iso(200, base),
    },
    {
      version: 'k-foreign',
      family: foreignFamily,
      secret: KEYS.foreign,
      retiredAt: iso(2, base),
    },
  ]);
}

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

describe('bank family', () => {
  const env = {
    ...bank.env,
    PIGGYVEST_WEBHOOK_KEY_ARCHIVE: archive('bank', 'interest'),
  };

  it('accepts a bank archived key inside overlap at intake, never a revoked or foreign one', () => {
    const retained = readPrimaryWalletBankInboxRuntime(
      'intake',
      env
    )?.retainedWebhookSecrets;
    expect(retained).toEqual([KEYS.overlap]);
  });

  it('the worker re-checks stored rows with the same family replay-only keys too', () => {
    expect(
      readPrimaryWalletBankInboxRuntime('worker', env)?.retainedWebhookSecrets
    ).toEqual([KEYS.overlap, KEYS.revoked]);
  });

  it('a replayed delivery uses the replay scope at intake', () => {
    expect(
      readPrimaryWalletBankInboxRuntime('intake', env, 'replay')
        ?.retainedWebhookSecrets
    ).toEqual([KEYS.overlap, KEYS.revoked]);
  });

  it('keeps the current key and stays inside the configured retained cap', () => {
    const full = {
      ...env,
      PIGGYVEST_PRIMARY_BANK_RETAINED_WEBHOOK_SECRETS: JSON.stringify([
        'r1',
        'r2',
        'r3',
      ]),
    };
    const config = readPrimaryWalletBankInboxRuntime('worker', full);
    expect(config?.webhookSecret).toBe(bank.config.webhookSecret);
    expect(config?.retainedWebhookSecrets).toEqual([
      'r1',
      'r2',
      'r3',
      KEYS.overlap,
      KEYS.revoked,
    ]);
  });

  it('is unchanged without an archive', () => {
    expect(
      readPrimaryWalletBankInboxRuntime('worker', bank.env)
        ?.retainedWebhookSecrets
    ).toEqual([]);
  });
});

describe('interest family', () => {
  const env = {
    ...interestEnv,
    PIGGYVEST_WEBHOOK_KEY_ARCHIVE: archive('interest', 'bank'),
  };

  it('inbox intake: overlap only; worker and replay add the revoked key; foreign never', () => {
    expect(
      readPrimaryWalletPaidInterestInboxRuntime('intake', env)
        ?.retainedWebhookSecrets
    ).toEqual([KEYS.overlap]);
    expect(
      readPrimaryWalletPaidInterestInboxRuntime('worker', env)
        ?.retainedWebhookSecrets
    ).toEqual([KEYS.overlap, KEYS.revoked]);
    expect(
      readPrimaryWalletPaidInterestInboxRuntime('intake', env, 'replay')
        ?.retainedWebhookSecrets
    ).toEqual([KEYS.overlap, KEYS.revoked]);
  });

  it('direct path: intake accepts overlap only, the drain replays revoked keys', () => {
    expect(
      readPrimaryWalletPaidInterestRuntime(env, 'intake')
        ?.retainedWebhookSecrets
    ).toEqual([KEYS.overlap]);
    expect(
      readPrimaryWalletPaidInterestRuntime(env, 'drain')?.retainedWebhookSecrets
    ).toEqual([KEYS.overlap, KEYS.revoked]);
    expect(
      readPrimaryWalletPaidInterestRuntime(env, 'intake', 'replay')
        ?.retainedWebhookSecrets
    ).toEqual([KEYS.overlap, KEYS.revoked]);
  });
});

describe('custody family', () => {
  const env = {
    ...custody.environment,
    PIGGYVEST_WEBHOOK_KEY_ARCHIVE: archive('custody', 'bank', custody.now),
  };

  it('signed intake: overlap only; replay scope adds the revoked key; foreign never', () => {
    expect(
      readPrimaryCardCustodyIntakeRuntime(env, custody.now)
        ?.retainedWebhookSecrets
    ).toEqual([KEYS.overlap]);
    expect(
      readPrimaryCardCustodyIntakeRuntime(env, custody.now, 'replay')
        ?.retainedWebhookSecrets
    ).toEqual([KEYS.overlap, KEYS.revoked]);
  });

  it('the inbox worker (drain) re-checks stored rows with replay-only keys', () => {
    expect(
      readPrimaryCardCustodyInboxRuntime(env, custody.now, 'drain')
        ?.retainedWebhookSecrets
    ).toEqual([KEYS.overlap, KEYS.revoked]);
    expect(
      readPrimaryCardCustodyInboxRuntime(env, custody.now, 'intake')
        ?.retainedWebhookSecrets
    ).toEqual([KEYS.overlap]);
  });
});

describe('family isolation', () => {
  it('a key archived for one family never reaches another family runtime', () => {
    const onlyBank = JSON.stringify([
      {
        version: 'k-b',
        family: 'bank',
        secret: KEYS.overlap,
        retiredAt: iso(1),
      },
    ]);
    expect(
      readPrimaryWalletPaidInterestInboxRuntime('worker', {
        ...interestEnv,
        PIGGYVEST_WEBHOOK_KEY_ARCHIVE: onlyBank,
      })?.retainedWebhookSecrets
    ).toEqual([]);
    expect(
      readPrimaryCardCustodyIntakeRuntime(
        { ...custody.environment, PIGGYVEST_WEBHOOK_KEY_ARCHIVE: onlyBank },
        custody.now,
        'replay'
      )?.retainedWebhookSecrets
    ).toEqual([]);
  });

  it('an unreadable archive adds nothing and does not break the runtime', () => {
    expect(
      readPrimaryWalletBankInboxRuntime('worker', {
        ...bank.env,
        PIGGYVEST_WEBHOOK_KEY_ARCHIVE: '{broken',
      })?.retainedWebhookSecrets
    ).toEqual([]);
  });
});
