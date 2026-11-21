import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBrilStashToolClient } from './cli-client';

const dependencies = vi.hoisted(() => {
  const getUser = vi.fn();
  const client = { auth: { getUser } };
  return { client, getUser, createClient: vi.fn(() => client) };
});

vi.mock('@supabase/supabase-js', () => ({
  createClient: dependencies.createClient,
}));

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

beforeEach(() => {
  vi.clearAllMocks();
  dependencies.getUser.mockResolvedValue({ data: { user: { id: 'builder' } } });
  for (const [name, value] of Object.entries(hosted)) vi.stubEnv(name, value);
});
afterEach(() => vi.unstubAllEnvs());

describe('BrilStash CLI configuration', () => {
  it('returns a project-bound client after Supabase verifies the access token', async () => {
    await expect(createBrilStashToolClient()).resolves.toBe(
      dependencies.client
    );
    expect(dependencies.createClient).toHaveBeenCalledWith(
      hosted.NEXT_PUBLIC_SUPABASE_URL,
      hosted.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      expect.objectContaining({
        global: {
          headers: {
            Authorization: `Bearer ${hosted.BRILSTASH_TOOL_ACCESS_TOKEN}`,
          },
        },
      })
    );
    expect(dependencies.getUser).toHaveBeenCalledWith(
      hosted.BRILSTASH_TOOL_ACCESS_TOKEN
    );
  });

  it('rejects a token with an authenticated role claim that Supabase cannot verify', async () => {
    dependencies.getUser.mockResolvedValueOnce({
      data: { user: null },
      error: new Error('invalid signature'),
    });
    await expect(createBrilStashToolClient()).rejects.toThrow(
      'BrilStash CLI authentication failed'
    );
  });

  it('accepts a legacy anon key on a disposable loopback API', async () => {
    vi.stubEnv('BRILSTASH_TOOL_TARGET', 'local');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', token('anon'));
    await expect(createBrilStashToolClient()).resolves.toBe(
      dependencies.client
    );
  });

  it.each([
    ['NEXT_PUBLIC_SUPABASE_URL', 'https://unexpected.supabase.co'],
    ['BRILSTASH_TOOL_TARGET', 'local'],
    ['BRILSTASH_TOOL_ACCESS_TOKEN', token('service_role')],
    ['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'sb_secret_fixture'],
    ['NEXT_PUBLIC_SUPABASE_ANON_KEY', token('anon')],
  ])('rejects unsafe %s before opening a client', async (name, value) => {
    vi.stubEnv(name, value);
    await expect(createBrilStashToolClient()).rejects.toThrow(
      'Invalid BrilStash CLI database configuration'
    );
    expect(dependencies.createClient).not.toHaveBeenCalled();
  });
});
