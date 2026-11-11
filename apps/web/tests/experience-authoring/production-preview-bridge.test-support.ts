import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { readdirSync, readFileSync } from 'node:fs';
import { request as nodeRequest } from 'node:http';
import { Pool } from 'pg';
import { expect, vi } from 'vitest';
import { createProductionExperienceRuntime } from '@/lib/experience/local-owner-runtime';
import { createOwnerPreviewBridge } from '@/lib/experience/owner-preview-bridge';
import { createOwnerPreviewBridgeClient } from '@/lib/experience/owner-preview-bridge-client';
import type { PreviewVault } from '@/lib/experience/preview-service';
import { createProductionBuilderListener } from '@/lib/experience/production-builder-listener';
import { createOwnerPreviewNonceStore } from '../../tools/builder-auth/owner-preview-nonce';
import type { experienceDataFixture } from './data-fixture.test-support';

type Fixture = Awaited<ReturnType<typeof experienceDataFixture>>;
type Prerender = Parameters<typeof createProductionExperienceRuntime>[2];

/** Uses the real listener, RLS database, nonce ledger and built preview runtime. */
export async function launchThroughOwnerBridge(input: {
  fixture: Fixture;
  vault: PreviewVault;
  prerender: Prerender;
  buildId: string;
  hostOrigin: string;
  previewOrigin: string;
}) {
  const { fixture: f } = input;
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
  const pool = new Pool({
    host: f.db.localDatabase.socketDirectory,
    user: 'baci_owner_preview_login',
    database: 'postgres',
    options: '-c role=baci_owner_preview_nonce',
  });
  let listener: ReturnType<typeof createProductionBuilderListener> | undefined;
  try {
    const key = randomBytes(32);
    const runtime = createProductionExperienceRuntime(
      input.vault,
      input.hostOrigin,
      { ...input.prerender, previewOrigin: input.previewOrigin }
    );
    const bridge = createOwnerPreviewBridge({
      key,
      previewOrigin: input.previewOrigin,
      consumeNonce: await createOwnerPreviewNonceStore(pool),
      resolveUserClient: async (token) =>
        token === f.owner.accessToken ? f.owner.supabase : f.other.supabase,
      launch: runtime.createPreviewLaunch,
    });
    listener = createProductionBuilderListener({ keys: [] }, bridge);
    listener.server.listen(0, '127.0.0.1');
    await once(listener.server, 'listening');
    const address = listener.server.address();
    if (!address || typeof address === 'string') throw Error('NO_LISTENER');
    const client = createOwnerPreviewBridgeClient({
      key,
      executionOrigin: input.prerender.executionOrigin,
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
    const session = vi
      .spyOn(f.owner.supabase.auth, 'getSession')
      .mockResolvedValue({
        data: { session: { access_token: f.owner.accessToken } },
        error: null,
      } as never);
    try {
      const launch = await client(f.owner.supabase, {
        merchantId: f.merchantId,
        buildId: input.buildId,
        routeId: 'home',
      });
      expect(launch.merchantId).toBe(f.merchantId);
      expect(JSON.stringify(launch)).not.toContain(f.owner.accessToken);
      return launch;
    } finally {
      session.mockRestore();
    }
  } finally {
    await listener?.close();
    await pool.end();
  }
}
