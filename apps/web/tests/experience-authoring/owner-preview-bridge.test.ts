import { createHmac, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createOwnerPreviewBridge } from '@/lib/experience/owner-preview-bridge';
import { createOwnerPreviewNonceStore } from '../../tools/builder-auth/owner-preview-nonce';
import { experienceDataFixture } from './data-fixture.test-support';

it('uses normal authenticated RLS for owner preview handoff and denies another user and a revoked session', async () => {
  const f = await experienceDataFixture();
  let noncePool: Pool | undefined;
  try {
    const directory = new URL(
      '../../../../supabase/migrations/',
      import.meta.url
    );
    const migrations = readdirSync(directory).filter((name) =>
      name.endsWith('_owner_preview_nonce.sql')
    );
    expect(migrations).toHaveLength(1);
    await f.db.pool.query(
      readFileSync(new URL(migrations[0], directory), 'utf8')
    );
    await f.db.pool.query(
      'CREATE ROLE baci_owner_preview_login LOGIN NOINHERIT; GRANT baci_owner_preview_nonce TO baci_owner_preview_login'
    );
    if (!f.db.localDatabase) throw Error('LOCAL_DATABASE_REQUIRED');
    noncePool = new Pool({
      host: f.db.localDatabase.socketDirectory,
      user: 'baci_owner_preview_login',
      database: 'postgres',
      options: '-c role=baci_owner_preview_nonce',
    });
    const consumeNonce = await createOwnerPreviewNonceStore(noncePool);
    const key = new Uint8Array(32).fill(9);
    const now = Date.now();
    const launch = vi.fn(async () => ({ ok: true }));
    const bridge = createOwnerPreviewBridge({
      key,
      now: () => now,
      previewOrigin: 'https://builder.synthetic.test',
      consumeNonce,
      resolveUserClient: async (token) =>
        token === 'owner.fixture.token' ? f.owner.supabase : f.other.supabase,
      launch,
    });
    const call = (
      accessToken: string,
      nonce = randomUUID().replaceAll('-', '').repeat(2)
    ) => {
      const body = JSON.stringify({
        version: 1,
        nonce,
        expiresAt: now + 30000,
        accessToken,
        input: { merchantId: f.merchantId, buildId: randomUUID() },
      });
      const signature = createHmac('sha256', key)
        .update(`owner-preview/v1\n${body}`)
        .digest('hex');
      return bridge(
        new Request('https://mcp.usebaci.com/internal/owner/preview', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-baci-owner-signature': signature,
          },
          body,
        })
      );
    };
    const nonce = 'f'.repeat(64);
    expect((await call('owner.fixture.token', nonce)).status).toBe(200);
    expect((await call('owner.fixture.token', nonce)).status).toBe(409);
    expect((await call('other.fixture.token')).status).toBe(404);
    await f.db.pool.query(
      "UPDATE auth.sessions SET not_after=now()-interval '1 second' WHERE id=$1",
      [f.sessionId]
    );
    expect((await call('owner.fixture.token')).status).toBe(404);
    expect(launch).toHaveBeenCalledOnce();
  } finally {
    await noncePool?.end();
    await f.close();
  }
});
