// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { createApprovalPreparation } from './approval-preparation';
import { VerifierTemporarilyUnavailable } from './verifier-availability';

const expiredId = '11111111-1111-4111-8111-111111111111';
const freshId = '22222222-2222-4222-8222-222222222222';
function setup() {
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  const data = {
    approvalId: freshId,
    status: 'confirmation-required',
    effectDigest: 'a'.repeat(64),
    expiresAt,
  };
  const query = Promise.resolve({ data, error: null });
  const rpc = vi.fn(() => Object.assign(query, { abortSignal: () => query }));
  const client = { rpc } as unknown as Parameters<
    ReturnType<typeof createApprovalPreparation>
  >[0];
  const attest = vi.fn(async () => {});
  return {
    expiresAt,
    client,
    attest,
    rpc,
    prepare: createApprovalPreparation(attest, 'draft'),
  };
}

it('returns the renewed intent only after its independent proof is ready', async () => {
  const f = setup();
  f.attest.mockRejectedValueOnce(new VerifierTemporarilyUnavailable());
  await expect(f.prepare(f.client, expiredId)).resolves.toEqual({
    approvalId: freshId,
    status: 'preparing',
  });
  await expect(f.prepare(f.client, freshId)).resolves.toEqual({
    approvalId: freshId,
    status: 'ready',
    expiresAt: f.expiresAt,
  });
  expect(f.attest).toHaveBeenCalledWith(
    f.client,
    freshId,
    'draft',
    expect.any(AbortSignal)
  );
  expect(
    f.rpc.mock.calls.every(
      ([name]: unknown[]) => name === 'experience_prepare_approval'
    )
  ).toBe(true);
});

it('does not return a ready result after the owner disconnects', async () => {
  const f = setup();
  const abort = new AbortController();
  const error = Error('owner disconnected');
  f.attest.mockImplementationOnce(async () => abort.abort(error));
  await expect(f.prepare(f.client, expiredId, abort.signal)).rejects.toBe(
    error
  );
});

it('spans an expired review window while holding confirmation until all simulated routes finish', async () => {
  const start = Date.UTC(2026, 10, 23);
  let now = start;
  const date = vi.spyOn(Date, 'now').mockImplementation(() => now);
  let timeout: AbortController;
  let slice = 0;
  const clock = vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
    slice = ms;
    timeout = new AbortController();
    return timeout.signal;
  });
  const routes = Array.from({ length: 8 }, (_, i) => `/pages/route-${i}`);
  const completed = new Set<string>();
  const sessions: string[] = [];
  const rpc = vi.fn((_name: string, { p_intent }: { p_intent: string }) => {
    const renewed = p_intent === freshId || now >= start + 585_000;
    return Promise.resolve({
      data: {
        approvalId: renewed ? freshId : expiredId,
        status: 'confirmation-required',
        effectDigest: 'a'.repeat(64),
        expiresAt: new Date(
          start + (renewed ? 1_185_000 : 600_000)
        ).toISOString(),
      },
      error: null,
    });
  });
  const client = { rpc } as unknown as Parameters<
    ReturnType<typeof createApprovalPreparation>
  >[0];
  const prepare = createApprovalPreparation(
    (_client, approvalId, _kind, signal) => {
      sessions.push(approvalId);
      const end = now + slice;
      for (const route of routes) {
        if (completed.has(route)) continue;
        if (now + 80_000 >= end) {
          now = end;
          timeout.abort(new DOMException('Slice exhausted', 'TimeoutError'));
          signal?.throwIfAborted();
        }
        now += 80_000;
        completed.add(route);
      }
      return Promise.resolve();
    },
    'draft'
  );

  try {
    let approvalId = expiredId;
    let ready = false;
    for (let i = 0; i < 10; i++) {
      const result = await prepare(client, approvalId);
      approvalId = result.approvalId;
      if (result.status === 'ready') {
        expect(approvalId).toBe(freshId);
        ready = true;
        break;
      }
      expect(result.status).toBe('preparing');
    }
    expect(ready).toBe(true);
    expect(now - start).toBeGreaterThan(600_000);
    expect([...completed]).toEqual(routes);
    expect(sessions).toContain(expiredId);
    expect(sessions).toContain(freshId);
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(
      Array(rpc.mock.calls.length).fill('experience_prepare_approval')
    );
  } finally {
    date.mockRestore();
    clock.mockRestore();
  }
});
