import { createHmac, randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createOwnerPreviewBridge } from '@/lib/experience/owner-preview-bridge';
import { experienceDataFixture } from './data-fixture.test-support';

it('uses normal authenticated RLS for owner preview handoff and denies another user and a revoked session', async () => {
  const f = await experienceDataFixture();
  try {
    const key = new Uint8Array(32).fill(9);
    const now = Date.now();
    const seen = new Set<string>();
    const launch = vi.fn(async () => ({ ok: true }));
    const bridge = createOwnerPreviewBridge({
      key,
      now: () => now,
      previewOrigin: 'https://builder.synthetic.test',
      consumeNonce: async (nonce) => {
        if (seen.has(nonce)) return false;
        seen.add(nonce);
        return true;
      },
      resolveUserClient: async (token) =>
        token === 'owner.fixture.token' ? f.owner.supabase : f.other.supabase,
      launch,
    });
    const call = (accessToken: string) => {
      const body = JSON.stringify({
        version: 1,
        nonce: randomUUID().replaceAll('-', '').repeat(2),
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
    expect((await call('owner.fixture.token')).status).toBe(200);
    expect((await call('other.fixture.token')).status).toBe(404);
    await f.db.pool.query(
      "UPDATE auth.sessions SET not_after=now()-interval '1 second' WHERE id=$1",
      [f.sessionId]
    );
    expect((await call('owner.fixture.token')).status).toBe(404);
    expect(launch).toHaveBeenCalledOnce();
  } finally {
    await f.close();
  }
});
