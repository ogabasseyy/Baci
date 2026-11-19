import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { experienceDataFixture } from './data-fixture.test-support';

it('enforces live publish scope in normal authenticated database RPCs', async () => {
  const f = await experienceDataFixture();
  try {
    const args = {
      p_merchant: f.merchantId,
      p_connection: f.connectionId,
      p_version: 1,
    };
    const denied = await f.owner.supabase.rpc(
      'experience_authorize_publish',
      args
    );
    expect(denied.error?.message).toContain('INSUFFICIENT_SCOPE');
    expect(
      (await f.owner.supabase.rpc('experience_authorize_read', args)).data
    ).toBe(true);
    const publishConnection = randomUUID();
    await f.db.pool.query(
      "INSERT INTO builder_authorization.connections(id,actor_user_id,provider_grant_id,scopes,allowed_merchant_ids,expires_at) VALUES($1::uuid,$2,$1::text,ARRAY['storefront.read','storefront.write','storefront.publish'],ARRAY[$3::uuid],now()+interval '1 hour')",
      [publishConnection, f.actorId, f.merchantId]
    );
    args.p_connection = publishConnection;
    expect(
      (await f.owner.supabase.rpc('experience_authorize_publish', args)).data
    ).toBe(true);
    expect(
      (await f.other.supabase.rpc('experience_authorize_publish', args)).error
    ).not.toBeNull();
    expect(
      (await f.anonymous.rpc('experience_authorize_publish', args)).error
    ).not.toBeNull();
    expect(
      (
        await f.owner.supabase.rpc('disconnect_builder_connection', {
          p_connection_id: publishConnection,
        })
      ).error
    ).toBeNull();
    expect(
      (await f.owner.supabase.rpc('experience_authorize_publish', args)).error
    ).not.toBeNull();
  } finally {
    await f.close();
  }
});
