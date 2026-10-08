import { expect, it } from 'vitest';
import { primaryBankInboxFixture as fixture } from './primary-wallet-bank-inbox.test-fixture';
import { readPrimaryWalletBankInboxRuntime } from './primary-wallet-bank-inbox-runtime';

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
it('fails closed on explicitly enabled incomplete, malformed, expired or wrong-environment settings', () => {
  for (const env of [
    { NODE_ENV: 'test' as const, PIGGYVEST_PRIMARY_BANK_INBOX_ENABLED: 'true' },
    { ...fixture.env, PIGGYVEST_PRIMARY_BANK_INBOX_ENABLED: 'TRUE' },
    { ...fixture.env, VERCEL_ENV: 'production' },
    {
      ...fixture.env,
      PIGGYVEST_PRIMARY_BANK_INBOX_EXPIRES_AT: '2000-01-01T00:00:00Z',
    },
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
