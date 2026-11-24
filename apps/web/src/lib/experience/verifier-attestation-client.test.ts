// @vitest-environment node
import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { RunnerCapacityError } from '../../../tools/experience-runner/runner-transport';
import { createVerifierAttestationHandler } from '../../../tools/experience-verifier/attestation-handler';
import { createVerifierAttestationClient } from './verifier-attestation-client';
import { VerifierTemporarilyUnavailable } from './verifier-availability';

const key = new Uint8Array(32).fill(9);
const id = '11111111-1111-4111-8111-111111111111';
it('requires an explicitly installed transport', () => {
  expect(() => createVerifierAttestationClient({ key } as never)).toThrow(
    'INVALID_VERIFIER_CONFIG'
  );
});
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
      expect(url).toBe(
        'https://owner.baci-internal.invalid/internal/owner/attest'
      );
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
  expect(f.attest).toHaveBeenCalledWith(
    f.user,
    id,
    'draft',
    expect.any(AbortSignal)
  );
  expect(f.user.auth.getUser).toHaveBeenCalledWith('synthetic.token');
  expect(f.fetchImpl.mock.calls[0][1]).toMatchObject({
    redirect: 'error',
    cache: 'no-store',
    credentials: 'omit',
  });
});
it('distinguishes an unavailable verifier from a verifier denial', async () => {
  const f = fixture();
  f.fetchImpl.mockResolvedValueOnce(new Response(null, { status: 503 }));
  await expect(f.client(f.user as never, id, 'draft')).rejects.toBeInstanceOf(
    VerifierTemporarilyUnavailable
  );
  f.fetchImpl.mockResolvedValueOnce(new Response(null, { status: 403 }));
  await expect(
    f.client(f.user as never, id, 'draft')
  ).rejects.not.toBeInstanceOf(VerifierTemporarilyUnavailable);
});
it('retries attestation after runner capacity becomes available', async () => {
  const f = fixture();
  f.attest.mockRejectedValueOnce(new RunnerCapacityError());

  await expect(f.client(f.user as never, id, 'draft')).rejects.toBeInstanceOf(
    VerifierTemporarilyUnavailable
  );
  await expect(f.client(f.user as never, id, 'draft')).resolves.toBeUndefined();
  expect(f.attest).toHaveBeenCalledTimes(2);
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

it('cancels an in-flight attestation when the approval request disconnects', async () => {
  const f = fixture();
  const abort = new AbortController();
  const started = Promise.withResolvers<AbortSignal>();
  f.fetchImpl.mockImplementationOnce(async (_url, init) => {
    const signal = init?.signal;
    if (!signal) throw Error('Missing verifier signal');
    started.resolve(signal);
    return await new Promise<Response>((resolve, reject) => {
      abort.signal.addEventListener(
        'abort',
        () => {
          if (signal.aborted) reject(signal.reason);
          else resolve(new Response(null, { status: 204 }));
        },
        { once: true }
      );
    });
  });
  const pending = f.client(f.user as never, id, 'draft', abort.signal);
  const verifierSignal = await started.promise;
  abort.abort();
  expect(verifierSignal.aborted).toBe(true);
  await expect(pending).rejects.toBeInstanceOf(VerifierTemporarilyUnavailable);
});
