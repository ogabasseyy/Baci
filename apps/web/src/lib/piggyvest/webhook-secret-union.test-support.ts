import { createHash } from 'node:crypto';

/**
 * Deterministic, distinct signing keys derived from a label, so no signing
 * key is a hardcoded literal and every run uses the same inputs.
 */
export const testKey = (label: string): string =>
  createHash('sha256')
    .update(`webhook-secret-union-test:${label}`)
    .digest('hex');
