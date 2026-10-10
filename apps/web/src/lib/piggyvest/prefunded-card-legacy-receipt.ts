import 'server-only';
import { createDecipheriv, createHash } from 'node:crypto';
import { prefundedCardLegacyProofSchemas as schemas } from '@/schemas/prefunded-card-legacy-proof';

export function decryptPrefundedCardLegacyReceipt(
  input: unknown,
  key: unknown
): Buffer {
  try {
    const receipt = schemas.sealed.parse(input);
    const encryptionKey = schemas.encryptionKey.parse(key);
    // Explicit 16-byte GCM tag length: the schema pins authTag to 16 bytes,
    // and an explicit length keeps truncated tags rejected at the crypto layer.
    const decipher = createDecipheriv(
      'aes-256-gcm',
      Buffer.from(encryptionKey, 'base64'),
      Buffer.from(receipt.nonce, 'base64'),
      { authTagLength: 16 }
    );
    decipher.setAAD(
      Buffer.from(
        `piggyvest-staging:${receipt.keyVersion}:${receipt.payloadSha256}`
      )
    );
    decipher.setAuthTag(Buffer.from(receipt.authTag, 'base64'));
    const raw = Buffer.concat([
      decipher.update(Buffer.from(receipt.ciphertext, 'base64')),
      decipher.final(),
    ]);
    if (
      raw.length === 0 ||
      raw.length > 65536 ||
      createHash('sha256').update(raw).digest('hex') !== receipt.payloadSha256
    )
      throw new Error();
    return raw;
  } catch {
    throw new Error('Legacy receipt refused');
  }
}
