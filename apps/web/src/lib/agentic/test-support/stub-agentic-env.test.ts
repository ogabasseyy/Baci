// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { stubAgenticEnv } from './stub-agentic-env';

const STUBBED_NAMES = [
  'NODE_ENV',
  'SUPABASE_SERVICE_ROLE_KEY',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'OPENAI_AGENTIC_MERCHANT_SLUG',
  'OPENAI_AGENTIC_API_KEY',
  'OPENAI_AGENTIC_CONFIRMATION_KEY',
  'OPENAI_AGENTIC_SIGNING_KEY',
  'SUPABASE_JWT_SECRET',
  'PAYSTACK_SECRET_KEY',
] as const;

function snapshotEnv(): Record<string, string | undefined> {
  return Object.fromEntries(
    STUBBED_NAMES.map((name) => [name, process.env[name]])
  );
}

describe('stubAgenticEnv', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('sets every signing, payment and Supabase variable the agentic modules read', () => {
    stubAgenticEnv();

    for (const name of STUBBED_NAMES) {
      expect(process.env[name], name).toBeTruthy();
    }
    expect(process.env.NODE_ENV).toBe('test');
  });

  it('defaults the merchant slug to ogabassey and accepts another one', () => {
    stubAgenticEnv();
    expect(process.env.OPENAI_AGENTIC_MERCHANT_SLUG).toBe('ogabassey');

    stubAgenticEnv('second-merchant');
    expect(process.env.OPENAI_AGENTIC_MERCHANT_SLUG).toBe('second-merchant');
  });

  it('keeps the Supabase URL on a non-resolving example host', () => {
    stubAgenticEnv();

    expect(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').hostname).toBe(
      'supabase.example.com'
    );
  });

  it('puts every variable back when the stubs are removed', () => {
    const before = snapshotEnv();

    stubAgenticEnv();
    expect(snapshotEnv()).not.toEqual(before);
    vi.unstubAllEnvs();

    expect(snapshotEnv()).toEqual(before);
  });
});
