import 'server-only';
import { createDecipheriv, pbkdf2 } from 'node:crypto';
import { promisify } from 'node:util';
import {
  GIGL_WEBHOOK_BLOCK_BYTES as BLOCK_BYTES,
  GIGL_WEBHOOK_HEADER_BYTES as HEADER_BYTES,
  GIGL_WEBHOOK_KEY_BYTES as KEY_BYTES,
  GIGL_WEBHOOK_PBKDF2_ITERATIONS as PBKDF2_ITERATIONS,
  GIGL_WEBHOOK_SALT_BYTES as SALT_BYTES,
} from './gigl-webhook-crypto-constants';

const pbkdf2Async = promisify(pbkdf2);

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
