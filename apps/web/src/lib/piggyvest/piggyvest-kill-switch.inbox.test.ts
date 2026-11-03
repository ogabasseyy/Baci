import { describe, expect, it, vi } from 'vitest';
import { primaryBankInboxFixture as bank } from './primary-wallet-bank-inbox.test-fixture';
import { readPrimaryWalletBankInboxRuntime } from './primary-wallet-bank-inbox-runtime';
import { primaryCardCustodyInboxFixture as card } from './primary-wallet-card-custody-inbox.test-fixture';
import { readPrimaryCardCustodyInboxRuntime } from './primary-wallet-card-custody-inbox-runtime';
import { readPrimaryCardCustodyIntakeRuntime } from './primary-wallet-card-custody-intake-runtime';
import { paidInterestFixture as paid } from './primary-wallet-paid-interest.test-support';
import { readPrimaryWalletPaidInterestInboxRuntime } from './primary-wallet-paid-interest-inbox-runtime';

vi.mock('server-only', () => ({}));

const paidEnv = {
  NODE_ENV: 'test' as const,
  VERCEL_ENV: 'production',
  PIGGYVEST_PRIMARY_PAID_INTEREST_INBOX_ENABLED: 'true',
  PIGGYVEST_PRIMARY_PAID_INTEREST_INBOX_DRAIN_SCHEDULED: 'true',
  PIGGYVEST_PRIMARY_INTEGRATION_ID: paid.config.integrationId,
  PIGGYVEST_PRIMARY_ENVIRONMENT: 'production',
  PIGGYVEST_PRIMARY_PAID_INTEREST_BUSINESS_ID: paid.config.businessId,
  PIGGYVEST_PRIMARY_PAID_INTEREST_WEBHOOK_SECRET: paid.config.webhookSecret,
  PIGGYVEST_PRIMARY_DB_HOST: paid.config.database.host,
  PIGGYVEST_PRIMARY_DB_PORT: '5432',
  PIGGYVEST_PRIMARY_DB_NAME: 'postgres',
  PIGGYVEST_PRIMARY_EVIDENCE_DB_PASSWORD: paid.config.database.password,
  PIGGYVEST_PRIMARY_DB_CA: paid.config.database.certificateAuthority,
};
const killed = { PIGGYVEST_KILL_SWITCH: 'true' };

describe('kill switch closes every intake gate and leaves drain open', () => {
  it('bank inbox: intake refused, worker still drains', () => {
    expect(
      readPrimaryWalletBankInboxRuntime('intake', bank.env)
    ).not.toBeNull();
    expect(
      readPrimaryWalletBankInboxRuntime('intake', { ...bank.env, ...killed })
    ).toBeNull();
    expect(
      readPrimaryWalletBankInboxRuntime('worker', { ...bank.env, ...killed })
        ?.database.login
    ).toBe('baci_primary_bank_worker');
  });
  it('paid interest inbox: intake refused, worker still drains', () => {
    expect(
      readPrimaryWalletPaidInterestInboxRuntime('intake', paidEnv)
    ).not.toBeNull();
    expect(
      readPrimaryWalletPaidInterestInboxRuntime('intake', {
        ...paidEnv,
        ...killed,
      })
    ).toBeNull();
    expect(
      readPrimaryWalletPaidInterestInboxRuntime('worker', {
        ...paidEnv,
        ...killed,
      })
    ).not.toBeNull();
  });
  it('card custody intake runtime: refused under kill', () => {
    expect(
      readPrimaryCardCustodyIntakeRuntime(card.environment, card.now)
    ).not.toBeNull();
    expect(
      readPrimaryCardCustodyIntakeRuntime(
        { ...card.environment, ...killed },
        card.now
      )
    ).toBeNull();
  });
  it('card custody inbox: intake refused, drain still loads', () => {
    const env = { ...card.environment, ...killed };
    expect(readPrimaryCardCustodyInboxRuntime(env, card.now)).toBeNull();
    expect(
      readPrimaryCardCustodyInboxRuntime(env, card.now, 'drain')
    ).not.toBeNull();
  });
});
