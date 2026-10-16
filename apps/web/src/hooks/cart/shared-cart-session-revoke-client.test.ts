import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchWithCsrf } from '@/lib/api-client';

import { revokeCartDeviceSession } from './shared-cart-session-revoke-client';

vi.mock('@/lib/api-client', () => ({
  fetchWithCsrf: vi.fn(),
}));

const fetchMock = vi.mocked(fetchWithCsrf);
function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status });
}
beforeEach(() => {
  fetchMock.mockReset();
});

describe('shared-cart session-revoke client', () => {
  it('revokes only the device session on sign-out', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ revoked: true }));
    await expect(revokeCartDeviceSession('shop')).resolves.toEqual({
      ok: true,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/storefront/cart/session/revoke?merchantSlug=shop',
      expect.objectContaining({ method: 'POST', body: '{}' })
    );
  });

  it('fails closed when enrollment rejection did not revoke device authority', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ code: 'merchant_unavailable' }, 403)
    );
    await expect(revokeCartDeviceSession('legacy')).resolves.toEqual({
      ok: false,
    });
  });

  it('still fails closed on revocation transport errors', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    await expect(revokeCartDeviceSession('shop')).resolves.toEqual({
      ok: false,
    });
  });

  it('allows logout when the server confirms no proof exists to retire', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: 'missing_proof' }, 401));
    await expect(revokeCartDeviceSession('shop')).resolves.toEqual({
      ok: true,
    });
  });

  it('allows logout when the proof is definitively invalid', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: 'invalid_proof' }, 401));
    await expect(revokeCartDeviceSession('shop')).resolves.toEqual({
      ok: true,
    });
  });
});
