import { primaryWalletCardCheckoutFixture as fixture } from './primary-wallet-card-checkout.test-fixture';

/**
 * Every PIGGYVEST_PRIMARY_CARD_* deployment variable, set to values the
 * strict runtime reader accepts: a fully enabled, scheduled, unexpired
 * staging rail with abandonment approved. Used to prove that retired
 * card initialization stays refused even under a complete configuration,
 * while the status and abandonment drains keep working.
 */
export const enabledPrimaryCardRuntimeEnv = {
  NODE_ENV: 'test',
  VERCEL_ENV: 'preview',
  PIGGYVEST_PRIMARY_CARD_ENABLED: 'true',
  PIGGYVEST_PRIMARY_CARD_TRANSFER_SCHEDULED: 'true',
  PIGGYVEST_PRIMARY_CARD_CUSTODY_SCHEDULED: 'true',
  PIGGYVEST_PRIMARY_CARD_ENVIRONMENT: fixture.settings.environment,
  PIGGYVEST_PRIMARY_CARD_INTEGRATION_ID: fixture.settings.integrationId,
  PIGGYVEST_PRIMARY_CARD_MERCHANT_ID: fixture.settings.merchantId,
  PIGGYVEST_PRIMARY_CARD_BUSINESS_ID: fixture.settings.businessId,
  PIGGYVEST_PRIMARY_CARD_EXPIRES_AT: fixture.settings.expiresAt,
  PIGGYVEST_PRIMARY_CARD_CALLBACK_URL: fixture.settings.callbackUrl,
  PIGGYVEST_PRIMARY_CARD_PAYSTACK_SECRET: fixture.settings.paystackSecret,
  PIGGYVEST_PRIMARY_CARD_DB_HOST: fixture.database.host,
  PIGGYVEST_PRIMARY_CARD_DB_PORT: String(fixture.database.port),
  PIGGYVEST_PRIMARY_CARD_DB_NAME: fixture.database.name,
  PIGGYVEST_PRIMARY_CARD_DB_CA: fixture.database.certificateAuthority,
  PIGGYVEST_PRIMARY_CARD_AUTHORIZER_PASSWORD: fixture.database.password,
  PIGGYVEST_PRIMARY_CARD_EVIDENCE_PASSWORD: fixture.database.password,
  PIGGYVEST_PRIMARY_CARD_ABANDONMENT_APPROVED: 'true',
} as const;
