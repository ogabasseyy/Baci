import 'server-only';
import { createDecipheriv, pbkdf2 } from 'node:crypto';
import { promisify } from 'node:util';

const pbkdf2Async = promisify(pbkdf2);

// GIG's documented scheme: base64(salt[16] | iv[16] | AES-256-CBC ciphertext),
// key = PBKDF2-HMAC-SHA1(secret, salt, 10000 iterations, 32 bytes), PKCS7.
const SALT_BYTES = 16;
const IV_BYTES = 16;
const BLOCK_BYTES = 16;
const KEY_BYTES = 32;
const PBKDF2_ITERATIONS = 10_000;
const HEADER_BYTES = SALT_BYTES + IV_BYTES;
const utf8 = new TextDecoder('utf-8', { fatal: true });

/**
 * Decrypts one GIG webhook payload. Every failure (malformed framing,
 * wrong secret, bad padding, invalid UTF-8) collapses to null so callers
 * can answer identically: AES-CBC carries no MAC, and distinguishing a
 * padding failure from a later parse failure would be a padding oracle.
 */
export async function decryptGiglWebhookPayload(
  ciphertext: string,
  secret: string
): Promise<string | null> {
  const bytes = Buffer.from(ciphertext, 'base64');
  const bodyBytes = bytes.length - HEADER_BYTES;
  if (!secret || bodyBytes < BLOCK_BYTES || bodyBytes % BLOCK_BYTES !== 0) {
    return null;
  }

  const salt = bytes.subarray(0, SALT_BYTES);
  const iv = bytes.subarray(SALT_BYTES, HEADER_BYTES);
  try {
    const key = await pbkdf2Async(
      secret,
      salt,
      PBKDF2_ITERATIONS,
      KEY_BYTES,
      'sha1'
    );
    const decipher = createDecipheriv('aes-256-cbc', key, iv);
    const plaintext = Buffer.concat([
      decipher.update(bytes.subarray(HEADER_BYTES)),
      decipher.final(),
    ]);
    return utf8.decode(plaintext);
  } catch {
    return null;
  }
}
