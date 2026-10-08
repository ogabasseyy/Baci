import { createHash, createHmac } from 'node:crypto';

const event = {
  eventId: 'bank-event',
  eventType: 'bank-transfer.inflow.success',
  eventCategory: 'inflow_transaction',
  customer_id: 'owned-customer',
  pvb_reference: 'provider-reference',
  pvb_wallet: 'owned-wallet',
  eventData: {
    id: 'detail',
    customer_id: 'owned-customer',
    destination_wallet_id: 'conduit-wallet',
    type: 'inter',
    category: 'bank_transfer_inflow',
    amount: 10000,
    currency: 'NGN',
    narration: 'Synthetic sender',
    ip_address: '',
    transaction_id: 'bank-transaction',
    timestamp: '2026-10-07T10:00:00.000Z',
    status: 'COMPLETED',
    third_party_reference: '',
    initiator_reference: '',
    internal_reference: '',
    provider: 'synthetic-bank',
    destination_wallet_balance: 10000,
    destination_wallet_ledger_balance: 10000,
    destination_transaction_balance: 10000,
    reference: 'bank-reference',
    fee: 0,
  },
};
const config = {
  integrationId: '11111111-1111-4111-8111-111111111111',
  environment: 'staging' as const,
  scope: {
    merchantId: '22222222-2222-4222-8222-222222222222',
    businessId: 'owned-business',
    expiresAt: '2099-01-01T00:00:00.000Z',
  },
  webhookSecret: 'synthetic-bank-signing-secret',
  retainedWebhookSecrets: [],
  database: {
    host: 'db.example.test',
    port: 5432,
    name: 'fixture_db',
    login: 'baci_primary_bank_intake' as const,
    password: 'synthetic-password',
    certificateAuthority: 'synthetic-ca',
  },
};
const rawBody = Buffer.from(JSON.stringify(event, null, 2));
const signature = createHmac('sha512', config.webhookSecret)
  .update(rawBody)
  .digest('hex');
export const primaryBankInboxFixture = {
  event,
  config,
  rawBody,
  signature,
  claim: {
    eventId: event.eventId,
    token: '33333333-3333-4333-8333-333333333333',
    rawHex: rawBody.toString('hex'),
    signature,
    bodyDigest: createHash('sha256').update(rawBody).digest('hex'),
    attempts: 1,
  },
  env: {
    NODE_ENV: 'test' as const,
    VERCEL_ENV: 'preview',
    PIGGYVEST_PRIMARY_BANK_INBOX_ENABLED: 'true',
    PIGGYVEST_PRIMARY_INTEGRATION_ID: config.integrationId,
    PIGGYVEST_PRIMARY_ENVIRONMENT: config.environment,
    PIGGYVEST_PRIMARY_MERCHANT_ID: config.scope.merchantId,
    PIGGYVEST_PRIMARY_BUSINESS_ID: config.scope.businessId,
    PIGGYVEST_PRIMARY_BANK_INBOX_EXPIRES_AT: config.scope.expiresAt,
    PIGGYVEST_PRIMARY_BANK_INBOX_WEBHOOK_SECRET: config.webhookSecret,
    PIGGYVEST_PRIMARY_DB_HOST: config.database.host,
    PIGGYVEST_PRIMARY_DB_PORT: '5432',
    PIGGYVEST_PRIMARY_DB_NAME: config.database.name,
    PIGGYVEST_PRIMARY_BANK_INTAKE_PASSWORD: config.database.password,
    PIGGYVEST_PRIMARY_BANK_WORKER_PASSWORD: config.database.password,
    PIGGYVEST_PRIMARY_DB_CA: config.database.certificateAuthority,
  },
};
