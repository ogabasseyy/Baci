import { createCipheriv, createHash } from 'node:crypto';
import { event as bank } from './replay-test-fixtures';

export function createPaidInterestTestFixture() {
  const now = Math.floor(Date.now() / 1000);
  const token = (role: string) =>
    `header.${Buffer.from(JSON.stringify({ role, iat: now, exp: now + 3600 })).toString('base64url')}.synthetic`;
  const key = Buffer.alloc(32, 7);
  const appSystemId = '7685292944002592802';
  const paidInterestDatabase = {
    host: 'piggyvest-db.staging.baci.internal',
    port: 5432,
    database: 'postgres',
    role: 'prefunded_treasury_operator',
    password: 'synthetic-password',
    integrationId: '40000000-0000-4000-8000-000000000001',
    businessId: 'synthetic-business',
    ssl: { ca: 'synthetic-ca' },
  };
  const scope = {
    environment: 'staging',
    integrationId: paidInterestDatabase.integrationId,
    merchantId: '40000000-0000-4000-8000-000000000002',
    treasuryBindingId: '40000000-0000-4000-8000-000000000003',
    businessId: paidInterestDatabase.businessId,
    expectedSystemId: appSystemId,
  };
  const privateBytes = Buffer.from(JSON.stringify({ scope }));
  const bundle = Buffer.from('synthetic pinned factory');
  const digest = (bytes: Buffer) =>
    createHash('sha256').update(bytes).digest('hex');
  const interest = {
    eventId: 'paid-interest-001',
    eventType: 'interest-payout.success',
    eventCategory: 'interest_payout',
    customer_id: 'provider-customer-001',
    pvb_wallet: 'not-the-interest-source',
    pvb_accrued_interest_wallet: 'source-interest-wallet',
    pvb_destination_wallet: null,
    pvb_third_party_reference: null,
    pvb_reference: 'paid-reference-001',
    eventData: {
      id: 'paid-payout-001',
      amount: 1000,
      destination_wallet: 'paid-destination-wallet',
      destination_wallet_balance: 1000,
      destination_wallet_ledger_balance: 1000,
      reference: 'paid-reference-001',
      timestamp: '2026-10-03T12:00:00Z',
      batch_id: 'paid-batch-001',
      break_down: {
        gross_interest_payout: 1100,
        withholding_tax: 100,
        net_interest_payout: 1000,
      },
    },
  };
  const outflow = {
    eventId: 'native-outflow-001',
    eventType: 'wallet-transfer.outflow.success',
    eventCategory: 'wallet_transfer',
    customer_id: 'provider-customer-001',
    eventData: { reference: 'native-transfer-001' },
  };
  const events = [bank, outflow, interest];
  const rows = events.map((value, index) => {
    const raw = Buffer.from(JSON.stringify(value));
    const payloadSha256 = digest(raw);
    const nonce = Buffer.alloc(12, index + 1);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(Buffer.from(`piggyvest-staging:staging-v1:${payloadSha256}`));
    const ciphertext = Buffer.concat([cipher.update(raw), cipher.final()]);
    return {
      receipt_id: `50000000-0000-4000-8000-00000000000${index + 1}`,
      payload_sha256: payloadSha256,
      ciphertext: ciphertext.toString('base64'),
      nonce: nonce.toString('base64'),
      auth_tag: cipher.getAuthTag().toString('base64'),
      key_version: 'staging-v1',
      claim_token: `60000000-0000-4000-8000-00000000000${index + 1}`,
      attempts: 1,
    };
  });
  const configuration = {
    environment: 'staging',
    receiptToken: token('pvb_staging_worker'),
    appToken: token('pvb_staging_app_worker'),
    receiptKey: key.toString('base64'),
    receiptSystemId: '7686901100561231906',
    appSystemId,
    paidInterestDatabase,
    prefundedReplay: {
      bundleSha256: digest(bundle),
      configurationSha256: digest(privateBytes),
    },
  };
  return { configuration, scope, privateBytes, bundle, events, rows, key };
}
