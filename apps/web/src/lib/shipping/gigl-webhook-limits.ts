/** GIG's sample delivery is ~600 bytes; addresses can make it longer. */
export const GIGL_WEBHOOK_MAX_BODY_BYTES = 16 * 1024;
/** Deadline for reading the request body before any decryption work. */
export const GIGL_WEBHOOK_READ_TIMEOUT_MS = 5_000;
/** Largest encrypted payload accepted, in base64 characters. */
export const GIGL_WEBHOOK_MAX_ENCRYPTED_CHARS = 16_384;
