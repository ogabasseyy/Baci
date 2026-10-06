import { createHash, createHmac } from 'node:crypto';
import { expect, it } from 'vitest';
import { createAccrualObserverTestFixture } from './replay-accrual-observer.test-support';
import { decryptAndValidateReceipt } from './replay-crypto';

it('keeps original signed fractional bytes and a fourth independent encrypted receipt', () => {
  const sample = createAccrualObserverTestFixture();
  const row = sample.rows[3];
  const decoded = decryptAndValidateReceipt(
    {
      payloadSha256: row.payload_sha256,
      ciphertext: row.ciphertext,
      nonce: row.nonce,
      authTag: row.auth_tag,
      keyVersion: 'staging-v1',
    },
    sample.key,
    'observed-accrual-1'
  );
  expect(decoded.raw).toEqual(sample.raw);
  expect(decoded.event.eventType).toBe('interest-accrued.success');
  expect(sample.raw.toString()).toContain('406.8493150684931234');
  expect(createHash('sha256').update(sample.privateBytes).digest('hex')).toBe(
    sample.configuration.prefundedReplay.configurationSha256
  );
  expect(
    createHmac('sha512', sample.secret).update(sample.raw).digest('hex')
  ).toBe(sample.signature);
});
