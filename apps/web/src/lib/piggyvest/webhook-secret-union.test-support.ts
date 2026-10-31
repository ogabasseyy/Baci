import { deterministicTestKey } from './deterministic-test-data.test-support';

/**
 * Deterministic, distinct signing keys derived from a label, so no signing
 * key is a hardcoded literal and every run uses the same inputs.
 */
export const testKey = (label: string): string =>
  deterministicTestKey(`webhook-secret-union-test:${label}`);
