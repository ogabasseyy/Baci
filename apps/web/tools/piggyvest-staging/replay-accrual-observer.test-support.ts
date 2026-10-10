import { createCipheriv, createHash, createHmac } from 'node:crypto';
import { createPaidInterestTestFixture } from './replay-paid-interest.test-support';

export function createAccrualObserverTestFixture() {
  const sample = createPaidInterestTestFixture();
  const secret = 'synthetic-accrual-signing-secret';
  const raw = Buffer.from(
    `{"eventId":"observed-accrual-1","customer_id":"01M3N0TE6QWPFNPRGVCQG11N1P","eventType":"interest-accrued.success","eventCategory":"interest_accrued","eventData":{"id":"observed-accrual-1","wallet_id":"b7ff9afd-bb88-11f1-a539-42010a9c0026","balance":1650000,"percentage":9,"interest_date":"2026-10-03T00:00:00.000Z","amount":406.8493150684931234,"interest_type":"original"},"pvb_wallet":"01M3N0TE015JJR1YKBFC2JWZJ9","pvb_wallet_name":"Synthetic customer","pvb_split_interest_with_wallet":null,"pvb_split_interest_with_wallet_name":null}`
  );
  const digest = (bytes: Buffer) =>
    createHash('sha256').update(bytes).digest('hex');
  const payloadSha256 = digest(raw);
  const nonce = Buffer.alloc(12, 4);
  const cipher = createCipheriv('aes-256-gcm', sample.key, nonce);
  cipher.setAAD(Buffer.from(`piggyvest-staging:staging-v1:${payloadSha256}`));
  sample.rows.push({
    receipt_id: '50000000-0000-4000-8000-000000000004',
    payload_sha256: payloadSha256,
    ciphertext: Buffer.concat([cipher.update(raw), cipher.final()]).toString(
      'base64'
    ),
    nonce: nonce.toString('base64'),
    auth_tag: cipher.getAuthTag().toString('base64'),
    key_version: 'staging-v1',
    claim_token: '60000000-0000-4000-8000-000000000004',
    attempts: 1,
  });
  const privateBytes = Buffer.from(
    JSON.stringify({
      scope: sample.scope,
      evidence: {
        integrationId: sample.scope.integrationId,
        systemIdentifier: sample.configuration.appSystemId,
        webhookSecret: secret,
      },
    })
  );
  const observer = {
    database: {
      ...sample.configuration.paidInterestDatabase,
      role: 'piggyvest_staging_ledger_worker',
    },
    wrapperDefinitionSha256: 'a'.repeat(64),
    originalDefinitionSha256: 'b'.repeat(64),
    executionDeadline: '2026-10-06T15:59:10Z',
  };
  const configuration = {
    ...sample.configuration,
    accrualObserver: observer,
    prefundedReplay: {
      ...sample.configuration.prefundedReplay,
      configurationSha256: digest(privateBytes),
    },
  };
  return {
    ...sample,
    configuration,
    privateBytes,
    raw,
    secret,
    observer,
    signature: createHmac('sha512', secret).update(raw).digest('hex'),
  };
}
