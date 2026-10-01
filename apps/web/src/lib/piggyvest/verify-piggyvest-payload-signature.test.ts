import { describe, expect, it } from 'vitest';
import { verifyPiggyvestPayloadSignature } from './verify-piggyvest-payload-signature';

const payload = new TextEncoder().encode('{"eventId":"synthetic-event"}');
const secret = 'synthetic-staging-secret';
const signature =
  'b3bf509cb43b26fd89487fd1cffb8dd9a4dcd4e1f54afa7584aa49134c2c81f46eff1b8b4e9d111b3bfb4bb9dfc7f6b18e8a04667d445e5166ccf705af53d304';

describe('verifyPiggyvestPayloadSignature', () => {
  it('accepts the documented SHA512 hex signature for exact payload bytes', () => {
    expect(
      verifyPiggyvestPayloadSignature({ payload, signature, secret })
    ).toBe(true);
  });

  it.each([
    undefined,
    '',
    '   ',
  ])('fails closed without a secret (%s)', (key) => {
    expect(
      verifyPiggyvestPayloadSignature({ payload, signature, secret: key })
    ).toBe(false);
  });

  it.each([
    null,
    '',
    'a'.repeat(127),
    'g'.repeat(128),
    `${signature},${signature}`,
  ])('rejects malformed or combined signature headers (%s)', (header) => {
    expect(
      verifyPiggyvestPayloadSignature({ payload, signature: header, secret })
    ).toBe(false);
  });

  it('rejects a valid-length signature from a different secret', () => {
    expect(
      verifyPiggyvestPayloadSignature({
        payload,
        signature,
        secret: 'another-synthetic-secret',
      })
    ).toBe(false);
  });

  it.each([
    '{"eventId":"tampered"}',
    '{ "eventId": "synthetic-event" }',
  ])('does not parse or normalize changed payload bytes (%s)', (changed) => {
    expect(
      verifyPiggyvestPayloadSignature({
        payload: new TextEncoder().encode(changed),
        signature,
        secret,
      })
    ).toBe(false);
  });
});
