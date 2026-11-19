import { createCipheriv, pbkdf2Sync } from 'node:crypto';

/**
 * Published sample from GIG's webhook documentation: this registration
 * secret decrypts this request body. Public doc values, not credentials.
 */
export const GIG_DOC_SAMPLE_SECRET = 'vgWA4WiL1pqtfFCvu3vb';
export const GIG_DOC_SAMPLE_BODY =
  'v2s/XHqwrg7jlNmn1+QVJmMVTN1XUVCfAeqUPtMuIwXjyO8239tJmHScQoGNs4RAPopNcwAvIxLsb802xIAosF4yWQc6nLh4vwT9yC/0+DzRXQYPCO/C/bc7vsYn2tUcjW5pZYKeAogitHgYh6kZEMQrD4YvXIxpOdwDkPKmDufuhPXkvjnatCg46rpDsTP9Zd5O460NVBsMahhs8/bGbD2/3DahuzZ1nmHmtxgZxWcmTVUFB8T/JLPNO3EIYdF/lp7NWPHXjbXv5zprNxdHvraje/7cpAZQW2MNazjVH7DBpT5MMk6lQocwwJ4gvtfrvSPJc5ui6UN+j/Q5xHk+p1dDj6LXnRowVPy7+E4M4NVrb7rKtfN8A1HLgC5SAdfSllV0EikxkqRaYdIrcjG5SDjXUgNP2+zWQcHSORHXiLdqR4jVAgAQcGLz8h+vsWF1iny2rTQNA4EiXNaNj7FtBP0H1lVWq5DTaMSlI6BJ9kjpWOphVYrK4AsQDYKJFJ4D';
export const GIG_DOC_SAMPLE_USER_ID = '949c9c99-5dd7-4db1-8980-1cbb3fa8fc99';
export const GIG_DOC_SAMPLE_CHANNEL_CODE = 'IND298636';

/**
 * Mirrors GIG's sender: base64(salt | iv | AES-256-CBC(PKCS7)), keyed by
 * PBKDF2-HMAC-SHA1(secret, salt, 10000, 32). Fixed salt/iv keep tests
 * deterministic.
 */
export function encryptLikeGig(
  plaintext: string,
  secret: string,
  salt = Buffer.alloc(16, 7),
  iv = Buffer.alloc(16, 9)
): string {
  const key = pbkdf2Sync(secret, salt, 10_000, 32, 'sha1');
  const cipher = createCipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([
    salt,
    iv,
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]).toString('base64');
}
