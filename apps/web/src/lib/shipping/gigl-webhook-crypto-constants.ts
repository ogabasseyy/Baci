// GIG's documented scheme: base64(salt[16] | iv[16] | AES-256-CBC ciphertext),
// key = PBKDF2-HMAC-SHA1(secret, salt, 10000 iterations, 32 bytes), PKCS7.
export const GIGL_WEBHOOK_SALT_BYTES = 16;
export const GIGL_WEBHOOK_IV_BYTES = 16;
export const GIGL_WEBHOOK_BLOCK_BYTES = 16;
export const GIGL_WEBHOOK_KEY_BYTES = 32;
export const GIGL_WEBHOOK_PBKDF2_ITERATIONS = 10_000;
export const GIGL_WEBHOOK_HEADER_BYTES =
  GIGL_WEBHOOK_SALT_BYTES + GIGL_WEBHOOK_IV_BYTES;
