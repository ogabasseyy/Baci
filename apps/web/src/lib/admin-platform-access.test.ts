import { describe, expect, it, vi } from 'vitest';
import {
  listAdminPlatformAccess,
  revokeAdminPlatformAccess,
  upsertAdminPlatformAccess,
} from './admin-platform-access';

function createClient(result: {
  data: unknown;
  error: { message: string } | null;
}) {
  const rpc = vi.fn().mockResolvedValue(result);
  return { client: { rpc } as never, rpc };
}

const membership = {
  created_at: '2026-08-05T10:00:00.000Z',
  email: 'owner@example.test',
  granted_at: '2026-08-05T10:00:00.000Z',
  is_legacy_owner: false,
  is_revocable: true,
  reason: 'Operational access',
  revoked_at: null,
  role: 'owner',
  status: 'active',
  updated_at: '2026-08-05T10:00:00.000Z',
};

describe('admin platform access RPC boundary', () => {
  it('parses only the safe membership list DTO', async () => {
    const { client, rpc } = createClient({ data: [membership], error: null });

    await expect(listAdminPlatformAccess(client)).resolves.toMatchObject({
      data: [membership],
      error: null,
    });
    expect(rpc).toHaveBeenCalledWith('list_platform_admin_memberships_v1', {
      p_limit: 100,
      p_offset: 0,
    });
  });

  it('passes confirmed writes through the fixed membership RPCs', async () => {
    const { client, rpc } = createClient({ data: [membership], error: null });

    await upsertAdminPlatformAccess(client, {
      confirmed: true,
      email: 'owner@example.test',
      reactivate: false,
      reason: 'Operational access',
      role: 'owner',
    });
    await revokeAdminPlatformAccess(client, {
      confirmed: true,
      email: 'owner@example.test',
      reason: 'Access is no longer required',
    });

    expect(rpc).toHaveBeenNthCalledWith(
      1,
      'upsert_platform_admin_membership_v1',
      expect.objectContaining({ p_confirmed: true, p_role: 'owner' })
    );
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      'revoke_platform_admin_membership_v1',
      expect.objectContaining({ p_confirmed: true })
    );
  });

  it('strips unexpected fields and fails closed for an invalid response shape', async () => {
    const { client } = createClient({
      data: [{ ...membership, user_id: 'secret-id' }],
      error: null,
    });

    const result = await listAdminPlatformAccess(client);
    expect(result).toMatchObject({
      data: [expect.objectContaining({ email: 'owner@example.test' })],
      error: null,
    });
    expect(result.data?.[0]).not.toHaveProperty('user_id');

    const { client: malformedClient } = createClient({
      data: [{ ...membership, is_revocable: 'yes' }],
      error: null,
    });
    await expect(
      listAdminPlatformAccess(malformedClient)
    ).resolves.toMatchObject({
      data: null,
      error: { code: 'INVALID_PLATFORM_ACCESS_PAYLOAD' },
    });
  });
});
