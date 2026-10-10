import { describe, expect, it } from 'vitest';
import { primaryWalletCardCheckoutFixture as fixture } from './primary-wallet-card-checkout.test-fixture';
import {
  readPrimaryWalletCardCheckoutRuntime,
  readPrimaryWalletCardCheckoutRuntimeDrain,
} from './primary-wallet-card-checkout-runtime';

const env: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  PIGGYVEST_PRIMARY_CARD_ENABLED: 'true',
  PIGGYVEST_PRIMARY_CARD_TRANSFER_SCHEDULED: 'true',
  PIGGYVEST_PRIMARY_CARD_CUSTODY_SCHEDULED: 'true',
  PIGGYVEST_PRIMARY_CARD_ENVIRONMENT: 'staging',
  PIGGYVEST_PRIMARY_CARD_INTEGRATION_ID: fixture.settings.integrationId,
  PIGGYVEST_PRIMARY_CARD_MERCHANT_ID: fixture.settings.merchantId,
  PIGGYVEST_PRIMARY_CARD_BUSINESS_ID: fixture.settings.businessId,
  PIGGYVEST_PRIMARY_CARD_EXPIRES_AT: fixture.settings.expiresAt,
  PIGGYVEST_PRIMARY_CARD_CALLBACK_URL: fixture.settings.callbackUrl,
  PIGGYVEST_PRIMARY_CARD_PAYSTACK_SECRET: fixture.settings.paystackSecret,
  PIGGYVEST_PRIMARY_CARD_DB_HOST: fixture.database.host,
  PIGGYVEST_PRIMARY_CARD_DB_PORT: '5432',
  PIGGYVEST_PRIMARY_CARD_DB_NAME: fixture.database.name,
  PIGGYVEST_PRIMARY_CARD_DB_CA: fixture.database.certificateAuthority,
  PIGGYVEST_PRIMARY_CARD_AUTHORIZER_PASSWORD: fixture.database.password,
  PIGGYVEST_PRIMARY_CARD_EVIDENCE_PASSWORD: fixture.database.password,
};
describe('primary card trusted deployment configuration', () => {
  it('accepts a current deployment deadline without a baked historical allowlist', () => {
    expect(readPrimaryWalletCardCheckoutRuntime(env)?.settings.expiresAt).toBe(
      fixture.settings.expiresAt
    );
  });
  it.each([
    { PIGGYVEST_PRIMARY_CARD_ENABLED: 'false' },
    { PIGGYVEST_PRIMARY_CARD_EXPIRES_AT: '2026-10-06T15:59:10Z' },
    { VERCEL_ENV: 'production' },
    { PIGGYVEST_PRIMARY_CARD_ENVIRONMENT: 'production' },
    { PIGGYVEST_PRIMARY_CARD_EVIDENCE_PASSWORD: '' },
    { PIGGYVEST_PRIMARY_CARD_TRANSFER_SCHEDULED: 'false' },
    { PIGGYVEST_PRIMARY_CARD_CUSTODY_SCHEDULED: undefined },
  ])('fails closed for invalid config %j', (override) => {
    expect(
      readPrimaryWalletCardCheckoutRuntime({ ...env, ...override })
    ).toBeNull();
  });
  it('drains scheduled-created operations after the workers are stood down', () => {
    const stoodDown = {
      ...env,
      PIGGYVEST_PRIMARY_CARD_TRANSFER_SCHEDULED: 'false',
      PIGGYVEST_PRIMARY_CARD_CUSTODY_SCHEDULED: 'false',
    };
    expect(readPrimaryWalletCardCheckoutRuntime(stoodDown)).toBeNull();
    expect(
      readPrimaryWalletCardCheckoutRuntimeDrain(stoodDown)?.settings
        .integrationId
    ).toBe(fixture.settings.integrationId);
  });
  it('rejects non-finite time', () => {
    expect(readPrimaryWalletCardCheckoutRuntime(env, Number.NaN)).toBeNull();
  });
  it('drains pre-expiry operations past the deadline for status and webhooks', () => {
    const expired = {
      ...env,
      PIGGYVEST_PRIMARY_CARD_EXPIRES_AT: '2026-10-06T15:59:10Z',
    };
    expect(readPrimaryWalletCardCheckoutRuntime(expired)).toBeNull();
    expect(
      readPrimaryWalletCardCheckoutRuntimeDrain(expired)?.settings.expiresAt
    ).toBe('2026-10-06T15:59:10Z');
  });
  it('drains enabled-created operations after the feature flag is turned off', () => {
    const disabled = { ...env, PIGGYVEST_PRIMARY_CARD_ENABLED: 'false' };
    expect(readPrimaryWalletCardCheckoutRuntime(disabled)).toBeNull();
    expect(
      readPrimaryWalletCardCheckoutRuntimeDrain(disabled)?.settings
        .integrationId
    ).toBe(fixture.settings.integrationId);
  });
  it.each([
    { VERCEL_ENV: 'production' },
    { PIGGYVEST_PRIMARY_CARD_ENVIRONMENT: 'production' },
    { PIGGYVEST_PRIMARY_CARD_EVIDENCE_PASSWORD: '' },
  ])('drain still fails closed for invalid config %j', (override) => {
    expect(
      readPrimaryWalletCardCheckoutRuntimeDrain({ ...env, ...override })
    ).toBeNull();
  });
  it('drain rejects non-finite time', () => {
    expect(
      readPrimaryWalletCardCheckoutRuntimeDrain(env, Number.NaN)
    ).toBeNull();
  });
});
