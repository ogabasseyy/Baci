import { describe, expect, it, vi } from 'vitest';
import type { CartPrincipal } from './principal';
import { getCartRealtimeAccess } from './realtime-access';

const now = new Date('2026-10-14T10:00:00Z');
const principal: CartPrincipal = {
  merchantId: 'm',
  cartId: 'c',
  grantId: 'g',
  principalId: 'p',
  scope: 'session',
  allowedOperations: ['add'],
  expiresAt: '2026-10-14T11:00:00Z',
};
function deps(data: unknown, error: unknown = null) {
  return {
    now,
    authorize: vi.fn().mockResolvedValue({ data, error }),
    issue: vi.fn().mockReturnValue({
      token: 'receive-only',
      expiresAt: '2026-10-14T10:03:00Z',
    }),
  };
}
describe('cart realtime access', () => {
  it('issues only after live grant authorization and bounds the token to that grant', async () => {
    const d = deps({
      ok: true,
      topic: 'cart:m:c',
      expiresAt: '2026-10-14T10:03:00Z',
    });
    expect(await getCartRealtimeAccess(principal, d)).toEqual({
      ok: true,
      topic: 'cart:m:c',
      token: 'receive-only',
      expiresAt: '2026-10-14T10:03:00Z',
    });
    expect(d.issue).toHaveBeenCalledWith({
      ...principal,
      expiresAt: '2026-10-14T10:03:00.000Z',
    });
  });
  it.each([
    { ok: false },
    { ok: true, topic: 'cart:other:c', expiresAt: '2026-10-14T10:03:00Z' },
    { ok: true, topic: 'cart:m:c', expiresAt: '2026-10-14T09:00:00Z' },
  ])('never issues for disabled/revoked/foreign/expired authority', async (data) => {
    const d = deps(data);
    expect((await getCartRealtimeAccess(principal, d)).ok).toBe(false);
    expect(d.issue).not.toHaveBeenCalled();
  });
  it('keeps authorization outages retryable without issuing authority', async () => {
    const d = deps(null, { message: 'private-db-error' });
    expect(await getCartRealtimeAccess(principal, d)).toEqual({
      ok: false,
      code: 'temporarily_unavailable',
    });
    expect(d.issue).not.toHaveBeenCalled();
  });
  it('rejects a bootstrap session before reading grant data', async () => {
    const d = deps(null);
    expect(
      (
        await getCartRealtimeAccess(
          { ...principal, scope: 'bootstrap', cartId: null, grantId: null },
          d
        )
      ).ok
    ).toBe(false);
    expect(d.authorize).not.toHaveBeenCalled();
  });
});
