import { expect, it } from 'vitest';
import { primaryBankInboxFixture as fixture } from './primary-wallet-bank-inbox.test-fixture';
import {
  readPrimaryWalletBankInboxRuntime,
  readPrimaryWalletBankInboxSecrets,
} from './primary-wallet-bank-inbox-runtime';

it.each([
  'intake',
  'worker',
] as const)('does not require new configuration on an old deployment for %s', (mode) => {
  expect(
    readPrimaryWalletBankInboxRuntime(mode, { NODE_ENV: 'test' })
  ).toBeNull();
  expect(
    readPrimaryWalletBankInboxRuntime(mode, {
      NODE_ENV: 'test',
      PIGGYVEST_PRIMARY_BANK_INBOX_ENABLED: 'false',
    })
  ).toBeNull();
});
it('exposes signing keys while the worker stays unconfigured', () => {
  const env = {
    NODE_ENV: 'test' as const,
    PIGGYVEST_PRIMARY_BANK_INBOX_ENABLED: 'true',
    PIGGYVEST_PRIMARY_BANK_INBOX_WEBHOOK_SECRET: 'bank-secret',
    PIGGYVEST_PRIMARY_BANK_RETAINED_WEBHOOK_SECRETS: JSON.stringify([
      'bank-retained',
    ]),
  };
  expect(readPrimaryWalletBankInboxSecrets(env)).toEqual({
    webhookSecret: 'bank-secret',
    retainedWebhookSecrets: ['bank-retained'],
  });
  expect(() => readPrimaryWalletBankInboxRuntime('intake', env)).toThrow(
    /Primary bank inbox/
  );
  expect(readPrimaryWalletBankInboxSecrets({ NODE_ENV: 'test' })).toBeNull();
});
it('keeps signing keys available while intake processing is rolled back', () => {
  const disabled = {
    NODE_ENV: 'test' as const,
    PIGGYVEST_PRIMARY_BANK_INBOX_ENABLED: 'false',
    PIGGYVEST_PRIMARY_BANK_INBOX_WEBHOOK_SECRET: 'bank-secret',
    PIGGYVEST_PRIMARY_BANK_RETAINED_WEBHOOK_SECRETS: JSON.stringify([
      'bank-retained',
    ]),
  };
  expect(readPrimaryWalletBankInboxSecrets(disabled)).toEqual({
    webhookSecret: 'bank-secret',
    retainedWebhookSecrets: ['bank-retained'],
  });
  expect(readPrimaryWalletBankInboxRuntime('intake', disabled)).toBeNull();
});
it('fails closed on explicitly enabled incomplete, malformed or wrong-environment settings', () => {
  for (const env of [
    { NODE_ENV: 'test' as const, PIGGYVEST_PRIMARY_BANK_INBOX_ENABLED: 'true' },
    { ...fixture.env, PIGGYVEST_PRIMARY_BANK_INBOX_ENABLED: 'TRUE' },
    { ...fixture.env, VERCEL_ENV: 'production' },
    {
      ...fixture.env,
      PIGGYVEST_PRIMARY_BANK_RETAINED_WEBHOOK_SECRETS: 'malformed-secret-value',
    },
  ])
    expect(() => readPrimaryWalletBankInboxRuntime('worker', env)).toThrow(
      /Primary bank inbox/
    );
});
it.each([
  'intake',
  'worker',
] as const)('drains existing mappings past the deposit deadline in %s mode', (mode) => {
  // Intake enqueues only owned (existing verified) mappings and the
  // worker processes only enqueued rows, so both modes are drain-only
  // by construction: refusing them past expiry would 503 signed
  // deposits into existing wallets until retries exhaust, stranding
  // money with no local credit. The deadline gates new exposure, never
  // the processing of deposits.
  const config = readPrimaryWalletBankInboxRuntime(mode, {
    ...fixture.env,
    PIGGYVEST_PRIMARY_BANK_INBOX_EXPIRES_AT: '2000-01-01T00:00:00Z',
  });
  expect(config?.scope.expiresAt).toBe('2000-01-01T00:00:00Z');
});
it.each([
  'intake',
  'worker',
] as const)('exposes configured retained keys in %s mode so rotation retries verify', (mode) => {
  const config = readPrimaryWalletBankInboxRuntime(mode, {
    ...fixture.env,
    PIGGYVEST_PRIMARY_BANK_RETAINED_WEBHOOK_SECRETS: JSON.stringify([
      'retained-bank-key',
    ]),
  });
  expect(config?.retainedWebhookSecrets).toEqual(['retained-bank-key']);
});
it('pins distinct intake/worker identities and accepts exact production configuration', () => {
  expect(
    readPrimaryWalletBankInboxRuntime('intake', fixture.env)?.database.login
  ).toBe('baci_primary_bank_intake');
  expect(
    readPrimaryWalletBankInboxRuntime('worker', fixture.env)?.database.login
  ).toBe('baci_primary_bank_worker');
  expect(
    readPrimaryWalletBankInboxRuntime('worker', {
      ...fixture.env,
      VERCEL_ENV: 'production',
      PIGGYVEST_PRIMARY_ENVIRONMENT: 'production',
    })?.environment
  ).toBe('production');
});
