// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { ServerSupabaseClient } from '@/app/api/quiz/_shared/route-helpers-guards';
import {
  consumeQuizAttestationChallenge,
  generateQuizAttestationNonce,
  hashQuizAttestationValue,
  issueQuizAttestationChallenge,
  isValidQuizAttestationNonce,
} from './quiz-attestation-challenge';

function rpcClient(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(result);
  return { client: { rpc } as Pick<ServerSupabaseClient, 'rpc'>, rpc };
}
const input = {
  eventId: 'e1',
  nonce: generateQuizAttestationNonce(),
  token: 'aGVhZA.cGF5bG9hZA.c2ln',
  tokenIssuedAt: new Date('2026-11-15T10:00:00Z'),
};

describe('quiz attestation challenge', () => {
  it('generates unique valid nonces and stores only the hash', async () => {
    const a = generateQuizAttestationNonce();
    expect(isValidQuizAttestationNonce(a)).toBe(true);
    expect(a).not.toBe(generateQuizAttestationNonce());
    const { client, rpc } = rpcClient({
      data: '2026-11-15T10:02:00Z',
      error: null,
    });
    const issued = await issueQuizAttestationChallenge(client, 'e1');
    const args = rpc.mock.calls[0][1];
    const nonce = issued.status === 'ok' ? issued.nonce : '';
    expect(nonce).not.toBe('');
    expect(args.p_nonce_hash).toBe(hashQuizAttestationValue(nonce));
    expect(args.p_nonce_hash).not.toBe(nonce);
  });
  it('returns null when issuing fails', async () => {
    const { client } = rpcClient({ data: null, error: new Error('x') });
    expect(await issueQuizAttestationChallenge(client, 'e1')).toEqual({
      status: 'error',
    });
  });
  it('reports the per-player cap (SQLSTATE 54000) as a limit, not an error', async () => {
    const { client } = rpcClient({
      data: null,
      error: { code: '54000', message: 'too many open challenges' },
    });
    expect(await issueQuizAttestationChallenge(client, 'e1')).toEqual({
      status: 'limit',
    });
  });
  it('accepts a challenge the database consumed', async () => {
    const { client } = rpcClient({ data: true, error: null });
    expect(await consumeQuizAttestationChallenge(client, input)).toBe(true);
  });
  it('rejects a replayed, expired or mismatched challenge (database says false)', async () => {
    const { client } = rpcClient({ data: false, error: null });
    expect(await consumeQuizAttestationChallenge(client, input)).toBe(false);
  });
  it('fails closed when the database call errors', async () => {
    const { client } = rpcClient({ data: true, error: new Error('down') });
    expect(await consumeQuizAttestationChallenge(client, input)).toBe(false);
  });
  it('never calls the database for a malformed nonce', async () => {
    const { client, rpc } = rpcClient({ data: true, error: null });
    expect(
      await consumeQuizAttestationChallenge(client, { ...input, nonce: 'bad' })
    ).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  describe('bugfix: one token replayed through a re-encoded signature', () => {
    it.each([
      ['padding appended', 'aGVhZA.cGF5bG9hZA.c2ln='],
      ['double padding appended', 'aGVhZA.cGF5bG9hZA.c2ln=='],
      ['non-canonical trailing bits', 'aGVhZA.cGF5bG9hZA.c2l'],
      ['non-canonical header trailing bits', 'aGVhZB.cGF5bG9hZA.c2ln'],
      ['non-canonical payload trailing bits', 'aGVhZA.cGF5bG9hZB.c2ln'],
      ['not three segments', 'aGVhZA.cGF5bG9hZA'],
    ])('rejects a token with %s without calling the database', async (_n, token) => {
      const { client, rpc } = rpcClient({ data: true, error: null });
      expect(
        await consumeQuizAttestationChallenge(client, { ...input, token })
      ).toBe(false);
      expect(rpc).not.toHaveBeenCalled();
    });
  });
});
