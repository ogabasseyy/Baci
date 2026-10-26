// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { builderConnectionViewsSchema } from './management';

describe('safe Baci connection management projection', () => {
  it('accepts owner metadata but rejects vault/provider fields', () => {
    const row = {
      connection_id: '20000000-0000-4000-8000-000000000001',
      scopes: ['storefront.read'],
      status: 'active',
      expires_at: '2026-11-01T00:00:00Z',
      created_at: '2026-10-22T00:00:00Z',
    };
    expect(builderConnectionViewsSchema.parse([row])).toHaveLength(1);
    expect(
      builderConnectionViewsSchema.safeParse([
        { ...row, refresh_token: 'secret' },
      ]).success
    ).toBe(false);
  });
});
it('validates the current user before invoking owner-scoped RPCs', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  const { listBuilderConnections, disconnectBuilderConnection } = await import(
    './management'
  );
  const client = createClient('https://fixture.supabase.co', 'fixture-public', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: { Authorization: 'Bearer fixture-user-token' },
      fetch: async (input) => {
        const path = new URL(String(input)).pathname;
        if (path === '/auth/v1/user')
          return Response.json({ id: '10000000-0000-4000-8000-000000000001' });
        return Response.json(
          path.endsWith('list_builder_connections') ? [] : true
        );
      },
    },
  });
  await expect(listBuilderConnections(client)).resolves.toEqual([]);
  await expect(
    disconnectBuilderConnection(client, '20000000-0000-4000-8000-000000000001')
  ).resolves.toBeUndefined();
});
