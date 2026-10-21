import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashIntakeCallerNet } from './hash-intake-caller-net';

vi.mock('server-only', () => ({}));

const NET_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('intake caller-network hash', () => {
  beforeEach(() => {
    vi.stubEnv('SUPABASE_STOREFRONT_INTAKE_NET_KEY', NET_KEY);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  it('is a stable 64-hex HMAC that never embeds the raw identifier', () => {
    const first = hashIntakeCallerNet('192.0.2.10');

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(hashIntakeCallerNet('192.0.2.10')).toBe(first);
    expect(first).not.toContain('192.0.2.10');
    expect(first).not.toContain('192');
  });
  it('separates identifiers and the unknown bucket', () => {
    const a = hashIntakeCallerNet('192.0.2.10');

    expect(hashIntakeCallerNet('192.0.2.11')).not.toBe(a);
    expect(hashIntakeCallerNet('unknown')).not.toBe(a);
    expect(hashIntakeCallerNet('unknown')).toMatch(/^[0-9a-f]{64}$/);
  });
  it('fails closed without the dedicated network key', () => {
    vi.stubEnv('SUPABASE_STOREFRONT_INTAKE_NET_KEY', '');

    expect(() => hashIntakeCallerNet('192.0.2.10')).toThrow(
      'Storefront intake network key is unavailable'
    );
  });
  it('fails closed on a short network key', () => {
    // A short/dictionary key would let a ledger exposure recover raw IPs
    // by offline dictionary attack plus IPv4 enumeration, so anything
    // under 32 characters is rejected like a missing key.
    vi.stubEnv('SUPABASE_STOREFRONT_INTAKE_NET_KEY', 'short-key');

    expect(() => hashIntakeCallerNet('192.0.2.10')).toThrow(
      'Storefront intake network key is unavailable'
    );
  });
  it('does not reuse the bearer intake JWT as key material', () => {
    // The JWT is transmitted on every RPC; keying the HMAC with it would
    // let any exposure retroactively reverse stored hashes. The network
    // key alone must determine the digest.
    vi.stubEnv(
      'SUPABASE_STOREFRONT_INTAKE_KEY',
      'header.eyJyb2xlIjoic3RvcmVmcm9udF9pbnRha2UifQ.signature'
    );
    const withJwt = hashIntakeCallerNet('192.0.2.10');
    vi.stubEnv('SUPABASE_STOREFRONT_INTAKE_KEY', '');

    expect(hashIntakeCallerNet('192.0.2.10')).toBe(withJwt);
  });
});
