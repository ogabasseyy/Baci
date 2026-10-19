import { expect, it } from 'vitest';
import { decryptAndValidateReceipt } from './replay-crypto';
import { createPaidInterestTestFixture } from './replay-paid-interest.test-support';

it('seals three distinct synthetic event categories with the existing receipt protocol', () => {
  const sample = createPaidInterestTestFixture();
  const events = sample.rows.map(
    (row) =>
      decryptAndValidateReceipt(
        {
          payloadSha256: row.payload_sha256,
          ciphertext: row.ciphertext,
          nonce: row.nonce,
          authTag: row.auth_tag,
          keyVersion: 'staging-v1',
        },
        sample.key,
        null
      ).event.eventType
  );
  expect(events).toEqual(sample.events.map((event) => event.eventType));
  expect(Object.keys(sample.scope)).toHaveLength(6);
  expect(sample.configuration).not.toHaveProperty('financialDatabase');
  expect(sample.configuration).not.toHaveProperty(
    'interestAccrualSigningSecret'
  );
});
