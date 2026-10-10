const assert = require('node:assert/strict');
const { createCipheriv, createHash, createHmac } = require('node:crypto');
const { test } = require('node:test');
const verifyReceiptCryptography = require('./receipt_crypto.cjs');

function fixture(raw = '{ "eventId": "synthetic-receipt-only" }\n') {
  const encryptionKey = Buffer.alloc(32, 8);
  const nonce = Buffer.alloc(12, 9);
  const providerSecret = 'test_key_Synthetic1234';
  const payloadSha256 = createHash('sha256').update(raw).digest('hex');
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, nonce);
  cipher.setAAD(Buffer.from(`piggyvest-staging:staging-v1:${payloadSha256}`));
  const ciphertext = Buffer.concat([cipher.update(raw), cipher.final()]);
  return {
    sealed: {
      payloadSha256,
      ciphertext: ciphertext.toString('base64'),
      nonce: nonce.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
      keyVersion: 'staging-v1',
    },
    encryptionKey: encryptionKey.toString('base64'),
    providerSecret,
    providerSignature: createHmac('sha512', providerSecret)
      .update(raw)
      .digest('hex'),
    originalRaw: raw,
  };
}

test('authenticates the exact original bytes with AEAD and provider HMAC without exposing them', () => {
  const input = fixture();
  const original = structuredClone(input);
  assert.deepEqual(verifyReceiptCryptography(input), {
    status: 'original-receipt-cryptography-verified',
    payloadSha256: input.sealed.payloadSha256,
    hmacSha512Verified: true,
    aeadVerified: true,
    plaintextMatchesAudit: true,
  });
  assert.deepEqual(input, original);
});

test('rejects reconstructed JSON even when its parsed content matches the original', () => {
  const input = fixture();
  input.originalRaw = JSON.stringify(JSON.parse(input.originalRaw));
  assert.throws(
    () => verifyReceiptCryptography(input),
    /^Error: original_receipt_cryptography_refused$/
  );
});

test('rejects tampered authentication, encrypted bytes and payload hash', () => {
  for (const mutate of [
    (input) => {
      input.sealed.ciphertext = Buffer.from('tampered').toString('base64');
    },
    (input) => {
      input.sealed.authTag = Buffer.alloc(16, 3).toString('base64');
    },
    (input) => {
      input.sealed.payloadSha256 = '0'.repeat(64);
    },
    (input) => {
      input.providerSignature = '0'.repeat(128);
    },
    (input) => {
      input.providerSecret = 'test_key_Wrong1234';
    },
    (input) => {
      input.encryptionKey = Buffer.alloc(32, 2).toString('base64');
    },
  ]) {
    const input = fixture();
    mutate(input);
    assert.throws(
      () => verifyReceiptCryptography(input),
      /^Error: original_receipt_cryptography_refused$/
    );
  }
});

test('refuses production credentials, noncanonical encodings and unrelated key versions', () => {
  for (const mutate of [
    (input) => {
      input.providerSecret = 'live_key_NotAllowed';
    },
    (input) => {
      input.sealed.keyVersion = 'production-v1';
    },
    (input) => {
      input.encryptionKey += '\n';
    },
    (input) => {
      input.sealed.nonce = Buffer.alloc(11).toString('base64');
    },
    (input) => {
      input.sealed.authTag = Buffer.alloc(15).toString('base64');
    },
    (input) => {
      input.sealed.ciphertext += ' ';
    },
    (input) => {
      input.providerSignature = input.providerSignature.toUpperCase();
    },
  ]) {
    const input = fixture();
    mutate(input);
    assert.throws(
      () => verifyReceiptCryptography(input),
      /^Error: original_receipt_cryptography_refused$/
    );
  }
});

test('rejects extra fields and over-sized original bytes with a sanitized refusal', () => {
  for (const mutate of [
    (input) => {
      input.unrelated = 'private-value';
    },
    (input) => {
      input.sealed.extra = 'private-value';
    },
    (input) => {
      input.originalRaw = 'private-value'.repeat(100000);
    },
  ]) {
    const input = fixture();
    mutate(input);
    assert.throws(
      () => verifyReceiptCryptography(input),
      /^Error: original_receipt_cryptography_refused$/
    );
  }
});
