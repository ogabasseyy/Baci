import { expect, it, vi } from 'vitest';
import { revokeCartDeviceGrants } from './device-session';

vi.mock('./scoped-client', () => ({ createCartRevocationClient: vi.fn() }));
const principal = {
  merchantId: 'm',
  cartId: 'c',
  grantId: 'g',
  principalId: 'p',
  scope: 'session' as const,
  allowedOperations: [],
  expiresAt: '2099-01-01T00:00:00Z',
};
it('revokes only through the proof-scoped RPC and masks provider failures', async () => {
  const rpc = vi
    .fn()
    .mockResolvedValue({ data: { ok: true, revoked: 2 }, error: null });
  expect(await revokeCartDeviceGrants(principal, { rpc })).toEqual({
    ok: true,
  });
  expect(rpc).toHaveBeenCalledWith('commerce_cart_revoke_device_grants');
  rpc.mockResolvedValue({
    data: null,
    error: { message: 'private database detail' },
  });
  expect(await revokeCartDeviceGrants(principal, { rpc })).toEqual({
    ok: false,
    code: 'temporarily_unavailable',
  });
});
it('can retire expired proofs and bootstrap roots without granting cart authority', async () => {
  const rpc = vi.fn().mockResolvedValue({ data: { ok: true }, error: null });
  expect(
    (
      await revokeCartDeviceGrants(
        { ...principal, scope: 'bootstrap' },
        { rpc }
      )
    ).ok
  ).toBe(true);
  expect(
    (
      await revokeCartDeviceGrants(
        { ...principal, expiresAt: '2000-01-01T00:00:00Z' },
        { rpc }
      )
    ).ok
  ).toBe(true);
  rpc.mockClear();
  expect(
    (
      await revokeCartDeviceGrants(
        { ...principal, expiresAt: 'invalid' },
        { rpc }
      )
    ).ok
  ).toBe(false);
  expect(rpc).not.toHaveBeenCalled();
});
