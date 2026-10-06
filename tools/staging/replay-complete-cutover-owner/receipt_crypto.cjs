const {
  createDecipheriv,
  createHash,
  createHmac,
  timingSafeEqual,
} = require('node:crypto');

const MAXIMUM_BYTES = 1024 * 1024;

function requireCondition(condition) {
  if (!condition) throw new Error('original_receipt_cryptography_refused');
}

function record(value, fields) {
  requireCondition(
    value !== null && typeof value === 'object' && !Array.isArray(value)
  );
  requireCondition(
    Object.keys(value).sort().join('|') === [...fields].sort().join('|')
  );
}

function decodeBase64(value, length) {
  requireCondition(
    typeof value === 'string' && value.length <= MAXIMUM_BYTES * 2
  );
  const decoded = Buffer.from(value, 'base64');
  requireCondition(decoded.toString('base64') === value && decoded.length > 0);
  requireCondition(
    length === undefined
      ? decoded.length <= MAXIMUM_BYTES
      : decoded.length === length
  );
  return decoded;
}

function verifyReceiptCryptography(input) {
  try {
    record(input, [
      'sealed',
      'encryptionKey',
      'providerSecret',
      'providerSignature',
      'originalRaw',
    ]);
    const { sealed, originalRaw, providerSignature, providerSecret } = input;
    record(sealed, [
      'payloadSha256',
      'ciphertext',
      'nonce',
      'authTag',
      'keyVersion',
    ]);
    requireCondition(
      typeof originalRaw === 'string' && sealed.keyVersion === 'staging-v1'
    );
    requireCondition(
      typeof providerSecret === 'string' &&
        /^test_key_[A-Za-z0-9]+$/.test(providerSecret)
    );
    requireCondition(
      typeof providerSignature === 'string' &&
        /^[a-f0-9]{128}$/.test(providerSignature)
    );
    requireCondition(
      typeof sealed.payloadSha256 === 'string' &&
        /^[a-f0-9]{64}$/.test(sealed.payloadSha256)
    );
    const original = Buffer.from(originalRaw, 'utf8');
    requireCondition(original.length > 0 && original.length <= MAXIMUM_BYTES);
    const decipher = createDecipheriv(
      'aes-256-gcm',
      decodeBase64(input.encryptionKey, 32),
      decodeBase64(sealed.nonce, 12)
    );
    decipher.setAAD(
      Buffer.from(`piggyvest-staging:staging-v1:${sealed.payloadSha256}`)
    );
    decipher.setAuthTag(decodeBase64(sealed.authTag, 16));
    const plaintext = Buffer.concat([
      decipher.update(decodeBase64(sealed.ciphertext)),
      decipher.final(),
    ]);
    requireCondition(
      plaintext.length === original.length &&
        timingSafeEqual(plaintext, original)
    );
    requireCondition(
      createHash('sha256').update(plaintext).digest('hex') ===
        sealed.payloadSha256
    );
    const expectedSignature = createHmac('sha512', providerSecret)
      .update(plaintext)
      .digest();
    requireCondition(
      timingSafeEqual(expectedSignature, Buffer.from(providerSignature, 'hex'))
    );
    return {
      status: 'original-receipt-cryptography-verified',
      payloadSha256: sealed.payloadSha256,
      hmacSha512Verified: true,
      aeadVerified: true,
      plaintextMatchesAudit: true,
    };
  } catch {
    throw new Error('original_receipt_cryptography_refused');
  }
}

module.exports = verifyReceiptCryptography;

if (require.main === module) {
  (async () => {
    try {
      const chunks = [];
      let totalBytes = 0;
      for await (const chunk of process.stdin) {
        totalBytes += chunk.length;
        requireCondition(totalBytes <= MAXIMUM_BYTES * 4);
        chunks.push(chunk);
      }
      const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      process.stdout.write(
        `${JSON.stringify(verifyReceiptCryptography(input))}\n`
      );
    } catch {
      process.stdout.write(
        '{"status":"original-receipt-cryptography-refused","redacted":true}\n'
      );
      process.exitCode = 1;
    }
  })();
}
