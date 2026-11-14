import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readdirSync, readFileSync } from 'node:fs';
import { request as nodeRequest } from 'node:http';
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
import { createProductionBuilderListener } from '@/lib/experience/production-builder-listener';
import { createOwnerPreviewNonceStore } from '../../tools/builder-auth/owner-preview-nonce';
import { experienceDataFixture } from './data-fixture.test-support';

it('routes a normal owner web preview through the signed handoff and durable RLS-backed admission', async () => {
  const f = await experienceDataFixture();
  let pool: Pool | undefined;
  let uninstall: (() => void) | undefined;
  let listener: ReturnType<typeof createProductionBuilderListener> | undefined;
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
    listener = createProductionBuilderListener({ keys: [] }, bridge);
    listener.server.listen(0, '127.0.0.1');
    await once(listener.server, 'listening');
    const address = listener.server.address();
    if (!address || typeof address === 'string')
      throw Error('LOCAL_LISTENER_MISSING');
    const client = createOwnerPreviewBridgeClient({
      key,
      executionOrigin: 'https://output.runtime.test',
      fetch: (url, init) => {
        if (
          url !== 'https://mcp.usebaci.com/internal/owner/preview' ||
          typeof init?.body !== 'string'
        )
          throw Error('INVALID_FIXTURE_REQUEST');
        const headers = new Headers(init.headers);
        headers.set('host', 'mcp.usebaci.com');
        return new Promise<Response>((resolve, reject) => {
          const req = nodeRequest(
            {
              host: '127.0.0.1',
              port: address.port,
              path: '/internal/owner/preview',
              method: 'POST',
              headers: Object.fromEntries(headers),
            },
            (res) => {
              const chunks: Buffer[] = [];
              res.on('data', (chunk: Buffer) => chunks.push(chunk));
              res.on('end', () =>
                resolve(
                  new Response(Buffer.concat(chunks), {
                    status: res.statusCode,
                    headers: { 'content-type': 'application/json' },
                  })
                )
              );
            }
          );
          req.on('error', reject);
          req.end(init.body);
        });
      },
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
    await listener?.close();
    await pool?.end();
    await f.close();
  }
});
