import { describe, expect, it, vi } from 'vitest';
import { requireExperienceOwner } from './authorization';

function context(user: string | null = 'owner', denied = false) {
  return {
    merchantId: 'merchant',
    supabase: {
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: user ? { id: user } : null },
          error: null,
        })),
      },
      rpc: vi.fn(async () => ({
        data: !denied,
        error: denied ? { message: 'private secret' } : null,
      })),
    },
  };
}
describe('experience owner authorization', () => {
  it('authenticates before owner RPC and does not expose database details', async () => {
    const c = context(null);
    await expect(requireExperienceOwner(c as never)).rejects.toThrow(
      'NOT_FOUND'
    );
    expect(c.supabase.rpc).not.toHaveBeenCalled();
    await expect(
      requireExperienceOwner(context('owner', true) as never)
    ).rejects.toThrow('NOT_FOUND');
  });
  it('binds owner and request-local normal client', async () => {
    const c = context();
    const r = await requireExperienceOwner(c as never);
    expect(r.actorUserId).toBe('owner');
    expect(r.supabase).toBe(c.supabase);
  });
});
it('does not promote a read-only outer token using a broader canonical connection grant', async () => {
  const c = context();
  const identity = {
    actorUserId: 'owner',
    connectionId: 'connection',
    grantVersion: 1,
    scopes: new Set(['storefront.read']),
    allowedMerchantIds: ['merchant'],
    allowCreateStore: false,
  };
  await expect(
    requireExperienceOwner({ ...c, identity } as never)
  ).rejects.toThrow('INSUFFICIENT_SCOPE');
  expect(c.supabase.rpc).not.toHaveBeenCalled();
});

it('rechecks publish scope in the dedicated DB RPC instead of downgrading it to read', async () => {
  const c = context();
  await requireExperienceOwner(c as never, 'storefront.publish');
  expect(c.supabase.rpc).toHaveBeenCalledWith('experience_authorize_publish', {
    p_merchant: 'merchant',
    p_connection: null,
    p_version: null,
  });
});
it('rejects a read-only connection before the publish DB check', async () => {
  const c = context();
  await expect(
    requireExperienceOwner(
      {
        ...c,
        identity: {
          actorUserId: 'owner',
          connectionId: 'c',
          grantVersion: 1,
          scopes: new Set(['storefront.read']),
          allowedMerchantIds: ['merchant'],
        },
      } as never,
      'storefront.publish'
    )
  ).rejects.toThrow('INSUFFICIENT_SCOPE');
  expect(c.supabase.rpc).not.toHaveBeenCalled();
});
