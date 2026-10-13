import 'server-only';
import { createDecipheriv, createHash } from 'node:crypto';
import type { z } from 'zod';
import type { prefundedCardLegacyProofSchemas as schemas } from '@/schemas/prefunded-card-legacy-proof';

export function decryptValidatedPrefundedCardLegacyReceipt(
  receipt: z.infer<typeof schemas.sealed>,
  encryptionKey: string
): Buffer {
  try {
    // Explicit 16-byte GCM tag length: the schema pins authTag to 16 bytes,
    // and an explicit length keeps truncated tags rejected at the crypto
    // layer. Callers must pass schema-validated input; errors are redacted
    // here so direct use never leaks distinguishing crypto failures.
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
