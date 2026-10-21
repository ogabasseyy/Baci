import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashIntakeCallerNet } from './hash-intake-caller-net';

vi.mock('server-only', () => ({}));

const tokenFor = (role: string) =>
  `header.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`;

describe('intake caller-network hash', () => {
  beforeEach(() => {
    vi.stubEnv('SUPABASE_STOREFRONT_INTAKE_KEY', tokenFor('storefront_intake'));
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
  it('fails closed without the restricted credential', () => {
    vi.stubEnv('SUPABASE_STOREFRONT_INTAKE_KEY', '');

    expect(() => hashIntakeCallerNet('192.0.2.10')).toThrow(
      'Restricted storefront intake credential is unavailable'
    );
  });
});
