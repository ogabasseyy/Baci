import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';
import { Pool } from 'pg';
import { expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  client: undefined as unknown,
  owner: true,
  csrf: true,
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => state.client,
}));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: async () => ({ valid: state.csrf }),
}));
vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: async (
    _client: unknown,
    _user: string,
    input: { requestedMerchantId: string }
  ) => ({
    merchantId: input.requestedMerchantId,
    staffAccess: { isOwner: state.owner },
  }),
}));

import { POST } from '@/app/api/builder-experience/preview/route';
import { createOwnerPreviewBridge } from '@/lib/experience/owner-preview-bridge';
import { createOwnerPreviewBridgeClient } from '@/lib/experience/owner-preview-bridge-client';
import { installRemoteOwnerPreview } from '@/lib/experience/owner-preview-remote-runtime';
import { createOwnerPreviewNonceStore } from '../../tools/builder-auth/owner-preview-nonce';
import { experienceDataFixture } from './data-fixture.test-support';

it('routes a normal owner web preview through the signed handoff and durable RLS-backed admission', async () => {
  const f = await experienceDataFixture();
  let pool: Pool | undefined;
  let uninstall: (() => void) | undefined;
  try {
    const directory = new URL(
      '../../../../supabase/migrations/',
      import.meta.url
    );
    const migration = readdirSync(directory).find((name) =>
      name.endsWith('_owner_preview_nonce.sql')
    );
    if (!migration || !f.db.localDatabase) throw Error('LOCAL_FIXTURE_MISSING');
    await f.db.pool.query(readFileSync(new URL(migration, directory), 'utf8'));
    await f.db.pool.query(
      'CREATE ROLE baci_owner_preview_login LOGIN NOINHERIT; GRANT baci_owner_preview_nonce TO baci_owner_preview_login'
    );
    pool = new Pool({
      host: f.db.localDatabase.socketDirectory,
      user: 'baci_owner_preview_login',
      database: 'postgres',
      options: '-c role=baci_owner_preview_nonce',
    });
    const consumeNonce = await createOwnerPreviewNonceStore(pool);
    const key = new Uint8Array(32).fill(7);
    const launch = vi.fn(async () => ({
      src: `https://output.runtime.test/resource/${'a'.repeat(64)}/index.html`,
      bindingId: randomUUID(),
      merchantId: f.merchantId,
      buildDigest: 'b'.repeat(64),
      instanceId: randomUUID(),
      nonce: randomUUID(),
      expiresAt: Date.now() + 300000,
      canonicalBase: 'https://merchant.synthetic.test/shop',
      routes: [{ path: '/', view: 'home' }],
      bootstrap: {
        route: {
          epoch: 1,
          routeId: 'home',
          params: {},
          canonicalPath: '/',
          publicDataRevision: 'r',
        },
        catalog: { products: [], revision: 'r' },
        capabilities: [],
      },
    }));
    const bridge = createOwnerPreviewBridge({
      key,
      previewOrigin: 'https://builder.synthetic.test',
      consumeNonce,
      resolveUserClient: async (token) =>
        token === f.owner.accessToken ? f.owner.supabase : f.other.supabase,
      launch,
    });
    const client = createOwnerPreviewBridgeClient({
      key,
      executionOrigin: 'https://output.runtime.test',
      fetch: (url, init) => bridge(new Request(url, init)),
    });
    uninstall = installRemoteOwnerPreview(client);
    state.client = f.owner.supabase;
    vi.spyOn(f.owner.supabase.auth, 'getSession').mockResolvedValue({
      data: { session: { access_token: f.owner.accessToken } },
      error: null,
    } as never);
    const body = {
      merchantId: f.merchantId,
      buildId: randomUUID(),
      routeId: 'home',
    };
    const request = () =>
      new NextRequest('https://usebaci.com/api/builder-experience/preview', {
        method: 'POST',
        body: JSON.stringify(body),
      });
    const result = await POST(request());
    expect(result.status).toBe(200);
    const response = await result.json();
    expect(response.merchantId).toBe(f.merchantId);
    expect(JSON.stringify(response)).not.toContain(f.owner.accessToken);
    state.csrf = false;
    expect((await POST(request())).status).toBe(403);
    state.csrf = true;
    state.owner = false;
    expect((await POST(request())).status).toBe(403);
    expect(launch).toHaveBeenCalledOnce();
  } finally {
    state.owner = true;
    state.csrf = true;
    state.client = undefined;
    uninstall?.();
    await pool?.end();
    await f.close();
  }
});
