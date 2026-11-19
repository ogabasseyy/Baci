import { describe, expect, it } from 'vitest';
import { resolveBrilStashToolConfiguration } from './cli-client';

function token(role: string) {
  return `test.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`;
}

const hosted = {
  BRILSTASH_TOOL_TARGET: 'hosted',
  BRILSTASH_SUPABASE_PROJECT_REF: 'sandboxproject',
  NEXT_PUBLIC_SUPABASE_URL: 'https://sandboxproject.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_fixture',
  BRILSTASH_TOOL_ACCESS_TOKEN: token('authenticated'),
};

describe('BrilStash CLI configuration', () => {
  it('binds the public key and authenticated access token to the configured project', () => {
    expect(resolveBrilStashToolConfiguration(hosted)).toMatchObject({
      url: hosted.NEXT_PUBLIC_SUPABASE_URL,
      publicKey: hosted.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    });
    expect(
      resolveBrilStashToolConfiguration({
        ...hosted,
        NEXT_PUBLIC_SUPABASE_URL: 'https://unexpected.supabase.co',
      })
    ).toBeNull();
  });

  it('accepts only loopback for disposable local runs and rejects service credentials', () => {
    expect(
      resolveBrilStashToolConfiguration({
        ...hosted,
        BRILSTASH_TOOL_TARGET: 'local',
        NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: token('anon'),
      })
    ).not.toBeNull();
    expect(
      resolveBrilStashToolConfiguration({
        ...hosted,
        BRILSTASH_TOOL_TARGET: 'local',
      })
    ).toBeNull();
    expect(
      resolveBrilStashToolConfiguration({
        ...hosted,
        BRILSTASH_TOOL_ACCESS_TOKEN: token('service_role'),
      })
    ).toBeNull();
    expect(
      resolveBrilStashToolConfiguration({
        ...hosted,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_secret_fixture',
      })
    ).toBeNull();
  });
});
