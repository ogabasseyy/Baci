import { createHmac } from 'node:crypto';
import { primaryCardCustodyFixture as fixture } from './primary-wallet-card-custody.test-fixture';

const signedInbox = {
  payloadContract: 'wallet-transfer-outflow-v1',
  mappingContract: 'single-transaction-third-party-reference-v1',
  batchSize: 2,
} as const;
const configuration = { ...fixture.configuration, signedInbox };
const { batchSize: _batch, ...contracts } = signedInbox;
const capability = JSON.stringify({
  ...configuration.crosswalkAuthority,
  ...contracts,
  merchantId: configuration.merchantId,
  businessId: configuration.businessId,
  expiresAt: configuration.expiresAt,
});
const rawBody = Buffer.from(JSON.stringify(fixture.envelope));
const signature = createHmac('sha512', configuration.webhookSecret)
  .update(rawBody)
  .digest('hex');

export const primaryCardCustodyInboxFixture = {
  ...fixture,
  configuration,
  capability,
  rawBody,
  signature,
  claim: {
    eventId: fixture.envelope.eventId,
    token: fixture.context.customerId,
    rawHex: rawBody.toString('hex'),
    signature,
    attempts: 1,
  },
  ready: { ready: true, sourceWalletId: fixture.context.sourceWalletId },
  environment: {
    NODE_ENV: 'test',
    VERCEL_ENV: 'preview',
    PIGGYVEST_PRIMARY_CARD_CUSTODY_ENABLED: 'true',
    PIGGYVEST_PRIMARY_CARD_SIGNED_INBOX_ENABLED: 'true',
    PIGGYVEST_PRIMARY_CARD_ENVIRONMENT: 'staging',
    PIGGYVEST_PRIMARY_CARD_INTEGRATION_ID: configuration.integrationId,
    PIGGYVEST_PRIMARY_CARD_MERCHANT_ID: configuration.merchantId,
    PIGGYVEST_PRIMARY_CARD_BUSINESS_ID: configuration.businessId,
    PIGGYVEST_PRIMARY_CARD_EXPIRES_AT: configuration.expiresAt,
    PIGGYVEST_PRIMARY_CARD_DB_HOST: configuration.custody.host,
    PIGGYVEST_PRIMARY_CARD_DB_PORT: String(configuration.custody.port),
    PIGGYVEST_PRIMARY_CARD_DB_NAME: configuration.custody.name,
    PIGGYVEST_PRIMARY_CARD_DB_CA: configuration.custody.certificateAuthority,
    PIGGYVEST_PRIMARY_CARD_TRANSFER_PASSWORD: configuration.transfer.password,
    PIGGYVEST_PRIMARY_CARD_CUSTODY_PASSWORD: configuration.custody.password,
    PIGGYVEST_PRIMARY_CARD_INTAKE_PASSWORD: 'fixture-intake-password',
    PIGGYVEST_PRIMARY_CARD_PIGGYVEST_TOKEN: configuration.apiToken,
    PIGGYVEST_PRIMARY_CARD_PIGGYVEST_WEBHOOK_SECRET:
      configuration.webhookSecret,
    PIGGYVEST_PRIMARY_CARD_CROSSWALK_CONTRACT_ID:
      configuration.crosswalkAuthority.contractId,
    PIGGYVEST_PRIMARY_CARD_CROSSWALK_ISSUER:
      configuration.crosswalkAuthority.evidenceIssuer,
    PIGGYVEST_PRIMARY_CARD_TREASURY_WEBHOOK_CUSTOMER_ID:
      configuration.crosswalkAuthority.treasuryWebhookCustomerId,
    PIGGYVEST_PRIMARY_CARD_TRANSACTION_CUSTOMER_ID:
      configuration.crosswalkAuthority.transactionCustomerId,
    PIGGYVEST_PRIMARY_CARD_SIGNED_PAYLOAD_CONTRACT: signedInbox.payloadContract,
    PIGGYVEST_PRIMARY_CARD_SIGNED_MAPPING_CONTRACT: signedInbox.mappingContract,
    PIGGYVEST_PRIMARY_CARD_SIGNED_BATCH_SIZE: String(signedInbox.batchSize),
  } as const,
};
