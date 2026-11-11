import { beforeEach, expect, it, vi } from 'vitest';

const f = vi.hoisted(() => ({
  create: vi.fn(),
  merchant: vi.fn(),
  auth: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: f.create }));
vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: f.merchant,
}));

import { resolveExperienceOwnerRequest } from './owner-request';

const id = '11111111-1111-4111-8111-111111111111';
const client = { auth: { getUser: f.auth }, rpc: f.rpc };
beforeEach(() => {
  vi.resetAllMocks();
  f.create.mockResolvedValue(client);
  f.auth.mockResolvedValue({ data: { user: { id: 'owner' } }, error: null });
  f.merchant.mockResolvedValue({
    merchantId: id,
    staffAccess: { isOwner: true },
  });
  f.rpc.mockResolvedValue({ data: true, error: null });
});
it('binds the normal authenticated owner to the requested merchant and repeats RLS authorization', async () => {
  expect(await resolveExperienceOwnerRequest(id)).toMatchObject({
    supabase: client,
    merchantId: id,
    actorUserId: 'owner',
  });
  expect(f.merchant).toHaveBeenCalledWith(client, 'owner', {
    requestedMerchantId: id,
  });
  expect(f.rpc).toHaveBeenCalledWith('experience_require_owner', {
    p_merchant: id,
    p_connection: null,
    p_version: null,
  });
});
it.each([
  { data: { user: null }, error: null },
  { data: { user: null }, error: { message: 'private' } },
])('denies unauthenticated requests before merchant access', async (auth) => {
  f.auth.mockResolvedValue(auth);
  await expect(resolveExperienceOwnerRequest(id)).rejects.toThrow('NOT_FOUND');
  expect(f.merchant).not.toHaveBeenCalled();
  expect(f.rpc).not.toHaveBeenCalled();
});
it.each([
  null,
  { merchantId: id, staffAccess: { isOwner: false } },
  { merchantId: 'other', staffAccess: { isOwner: true } },
])('denies missing, staff-only or mismatched merchant binding', async (merchant) => {
  f.merchant.mockResolvedValue(merchant);
  await expect(resolveExperienceOwnerRequest(id)).rejects.toThrow('NOT_FOUND');
  expect(f.rpc).not.toHaveBeenCalled();
});
it.each([
  { data: false, error: null },
  { data: null, error: { message: 'private' } },
])('fails closed on downstream ownership authorization failures', async (result) => {
  f.rpc.mockResolvedValue(result);
  await expect(resolveExperienceOwnerRequest(id)).rejects.toThrow('NOT_FOUND');
});
it('rechecks session validity before the owner authorization RPC', async () => {
  f.auth
    .mockResolvedValueOnce({ data: { user: { id: 'owner' } }, error: null })
    .mockResolvedValueOnce({ data: { user: null }, error: null });
  await expect(resolveExperienceOwnerRequest(id)).rejects.toThrow('NOT_FOUND');
  expect(f.rpc).not.toHaveBeenCalled();
});
