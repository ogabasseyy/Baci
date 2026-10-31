import { createHash } from 'node:crypto';

/**
 * Deterministic stand-ins for the random test data the PiggyVest suites used
 * to generate: the same label always yields the same value, so runs are
 * reproducible and never flaky, while distinct labels stay distinct. Keys are
 * derived through SHA-256 so no signing key appears as a string literal.
 */

const digest = (namespace: string, label: string): string =>
  createHash('sha256').update(`${namespace}:${label}`).digest('hex');

/** A 64-character hex secret, like a real webhook signing key. */
export const deterministicTestKey = (label: string): string =>
  digest('piggyvest-test-key', label);

/** A 128-character hex value in the shape of an HMAC-SHA512 signature. */
export const deterministicTestSignature = (label: string): string =>
  digest('piggyvest-test-signature:a', label) +
  digest('piggyvest-test-signature:b', label);

/** An RFC 4122 version-4 UUID (variant 8) that passes `z.uuid()`. */
export const deterministicTestUuid = (label: string): string => {
  const hex = digest('piggyvest-test-uuid', label);
  const variant = (Number.parseInt(hex[16] ?? '0', 16) % 4) + 8;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant.toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
