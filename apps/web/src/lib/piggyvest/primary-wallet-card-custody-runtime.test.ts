import { describe, expect, it } from 'vitest';
import { primaryCardCustodyFixture as fixture } from './primary-wallet-card-custody.test-fixture';
import { readPrimaryCardCustodyRuntime } from './primary-wallet-card-custody-runtime';

const config = fixture.configuration;
const env: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  PIGGYVEST_PRIMARY_CARD_CUSTODY_ENABLED: 'true',
  PIGGYVEST_PRIMARY_CARD_ENVIRONMENT: 'staging',
  VERCEL_ENV: 'preview',
  PIGGYVEST_PRIMARY_CARD_INTEGRATION_ID: config.integrationId,
  PIGGYVEST_PRIMARY_CARD_MERCHANT_ID: config.merchantId,
  PIGGYVEST_PRIMARY_CARD_BUSINESS_ID: config.businessId,
  PIGGYVEST_PRIMARY_CARD_EXPIRES_AT: config.expiresAt,
  PIGGYVEST_PRIMARY_CARD_DB_HOST: config.transfer.host,
  PIGGYVEST_PRIMARY_CARD_DB_PORT: String(config.transfer.port),
  PIGGYVEST_PRIMARY_CARD_DB_NAME: config.transfer.name,
  PIGGYVEST_PRIMARY_CARD_DB_CA: config.transfer.certificateAuthority,
  PIGGYVEST_PRIMARY_CARD_TRANSFER_PASSWORD: config.transfer.password,
  PIGGYVEST_PRIMARY_CARD_CUSTODY_PASSWORD: config.custody.password,
  PIGGYVEST_PRIMARY_CARD_PIGGYVEST_TOKEN: config.apiToken,
  PIGGYVEST_PRIMARY_CARD_PIGGYVEST_WEBHOOK_SECRET: config.webhookSecret,
  PIGGYVEST_PRIMARY_CARD_CROSSWALK_CONTRACT_ID:
    config.crosswalkAuthority.contractId,
  PIGGYVEST_PRIMARY_CARD_CROSSWALK_ISSUER:
    config.crosswalkAuthority.evidenceIssuer,
  PIGGYVEST_PRIMARY_CARD_TREASURY_WEBHOOK_CUSTOMER_ID:
    config.crosswalkAuthority.treasuryWebhookCustomerId,
  PIGGYVEST_PRIMARY_CARD_TRANSACTION_CUSTOMER_ID:
    config.crosswalkAuthority.transactionCustomerId,
};
describe('trusted custody deployment configuration', () => {
  it('does not require or synthesize financial transfer credentials for custody observation', () => {
    const parsed = readPrimaryCardCustodyRuntime(
      { ...env, PIGGYVEST_PRIMARY_CARD_TRANSFER_PASSWORD: undefined },
      fixture.now
    );
    expect(parsed).not.toBeNull();
    expect(parsed?.transfer).toBeUndefined();
  });
  it('pins current deployment deadline and approved crosswalk authority without a goal or Paystack credential', () => {
    expect(readPrimaryCardCustodyRuntime(env, fixture.now)).toEqual({
      ...config,
      retainedWebhookSecrets: [],
    });
  });
  it('exposes configured retained keys so the worker re-verifies rotation retries', () => {
    const parsed = readPrimaryCardCustodyRuntime(
      {
        ...env,
        PIGGYVEST_PRIMARY_CARD_RETAINED_PIGGYVEST_WEBHOOK_SECRETS:
          JSON.stringify(['retained-custody-key']),
      },
      fixture.now
    );
    expect(parsed?.retainedWebhookSecrets).toEqual(['retained-custody-key']);
  });
  it('loads past expiry so the worker drains acknowledged receipts instead of stranding them', () => {
    const parsed = readPrimaryCardCustodyRuntime(
      { ...env, PIGGYVEST_PRIMARY_CARD_EXPIRES_AT: '2026-09-29T15:59:10Z' },
      fixture.now
    );
    expect(parsed).not.toBeNull();
    expect(parsed?.expiresAt).toBe('2026-09-29T15:59:10Z');
  });
  it.each([
    { PIGGYVEST_PRIMARY_CARD_CUSTODY_ENABLED: 'false' },
    { VERCEL_ENV: 'production' },
    { PIGGYVEST_PRIMARY_CARD_CROSSWALK_ISSUER: undefined },
    { PIGGYVEST_PRIMARY_CARD_CROSSWALK_CONTRACT_ID: undefined },
    { PIGGYVEST_PRIMARY_CARD_TREASURY_WEBHOOK_CUSTOMER_ID: undefined },
    { PIGGYVEST_PRIMARY_CARD_TRANSACTION_CUSTOMER_ID: undefined },
    { PIGGYVEST_PRIMARY_CARD_CUSTODY_PASSWORD: undefined },
    {
      PIGGYVEST_PRIMARY_CARD_RETAINED_PIGGYVEST_WEBHOOK_SECRETS:
        'malformed-secret-value',
    },
  ])('fails closed for unavailable configuration %#', (change) => {
    expect(
      readPrimaryCardCustodyRuntime({ ...env, ...change }, fixture.now)
    ).toBeNull();
  });
  it('drains after a custody rollback while keeping credential and environment bindings', () => {
    const parsed = readPrimaryCardCustodyRuntime(
      { ...env, PIGGYVEST_PRIMARY_CARD_CUSTODY_ENABLED: 'false' },
      fixture.now,
      'drain'
    );
    expect(parsed).not.toBeNull();
    expect(parsed?.custody.login).toBe('baci_primary_card_custody');
    expect(
      readPrimaryCardCustodyRuntime(
        {
          ...env,
          PIGGYVEST_PRIMARY_CARD_CUSTODY_ENABLED: 'false',
          VERCEL_ENV: 'production',
        },
        fixture.now,
        'drain'
      )
    ).toBeNull();
    expect(
      readPrimaryCardCustodyRuntime(
        {
          ...env,
          PIGGYVEST_PRIMARY_CARD_CUSTODY_ENABLED: 'false',
          PIGGYVEST_PRIMARY_CARD_CUSTODY_PASSWORD: undefined,
        },
        fixture.now,
        'drain'
      )
    ).toBeNull();
  });
});
