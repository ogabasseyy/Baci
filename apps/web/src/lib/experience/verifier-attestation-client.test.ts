// @vitest-environment node
import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createVerifierAttestationHandler } from '../../../tools/experience-verifier/attestation-handler';
import { createVerifierAttestationClient } from './verifier-attestation-client';

const key = new Uint8Array(32).fill(9);
const id = '11111111-1111-4111-8111-111111111111';
function fixture() {
  const user = {
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: { access_token: 'synthetic.token' } },
        error: null,
      })),
      getUser: vi.fn(async () => ({ data: { user: { id } }, error: null })),
    },
  };
  const attest = vi.fn(async () => {});
  const handler = createVerifierAttestationHandler({
    key,
    consumeNonce: async () => true,
    resolveUserClient: async () => user as never,
    attest,
  });
  const fetchImpl = vi.fn(
    async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(url).toBe('https://mcp.usebaci.com/internal/owner/attest');
      return handler(
        new Request('https://verifier.baci-internal.invalid/v1/attest', init)
      );
    }
  );
  return {
    user,
    attest,
    fetchImpl,
    client: createVerifierAttestationClient({ key, fetch: fetchImpl }),
  };
}
it('forwards only a verified owner session and a signed approval locator', async () => {
  const f = fixture();
  await f.client(f.user as never, id, 'draft');
  expect(f.attest).toHaveBeenCalledWith(f.user, id, 'draft');
  expect(f.user.auth.getUser).toHaveBeenCalledWith('synthetic.token');
  expect(f.fetchImpl.mock.calls[0][1]).toMatchObject({
    redirect: 'error',
    cache: 'no-store',
    credentials: 'omit',
  });
});
it('does not forward revoked users or malformed approval IDs', async () => {
  const f = fixture();
  f.user.auth.getUser.mockResolvedValueOnce({
    data: { user: null },
    error: null,
  } as never);
  await expect(f.client(f.user as never, id, 'draft')).rejects.toThrow(
    'VERIFIER_UNAVAILABLE'
  );
  await expect(f.client(f.user as never, 'bad', 'draft')).rejects.toThrow();
  expect(f.fetchImpl).not.toHaveBeenCalled();
});
