import { afterEach, describe, expect, it, vi } from 'vitest';
import { AMOUNTS_KOBO } from './constants';
import {
  NOT_FOUND_UNCERTAIN,
  stepTimeoutRetry,
  TIMEOUT_BOOKED_ONCE,
  TIMEOUT_INDETERMINATE,
  TIMEOUT_TSQ_FIRST,
} from './proof-10-timeout-retry';
import { ProofBuilder } from './proof-builder';
import { setupScenario } from './scenario';
import { makeHarness } from './test-harness.test-support';

let dispose: (() => void) | null = null;
afterEach(() => {
  dispose?.();
  vi.restoreAllMocks();
});
const urlOf = (h: ReturnType<typeof makeHarness>) => h.mock.calls;
const posts = (h: ReturnType<typeof makeHarness>) =>
  urlOf(h).filter(
    (c) => c.method === 'POST' && c.pathname === '/api/v1/transfer/wallet'
  );

async function run(options: Parameters<typeof makeHarness>[0] = {}) {
  const h = makeHarness(options);
  dispose = h.dispose;
  await setupScenario(h.ctx);
  const b = new ProofBuilder('p10', 'S8');
  const before = posts(h).length;
  await stepTimeoutRetry(
    h.ctx,
    b,
    h.state.mainWalletId as string,
    h.state.goalWalletId as string
  );
  return { h, b, result: b.build(h.ctx), before };
}
const answer = (
  r: { findings: { id: string; answer: string }[] },
  id: string
) => r.findings.find((f) => f.id === id)?.answer;

describe('S8 timeout on submit, then status check', () => {
  it('sends the transfer once, checks status, and never resends', async () => {
    const { h, result, before } = await run();
    expect(posts(h)).toHaveLength(before + 1);
    expect(answer(result, TIMEOUT_INDETERMINATE)).toBe('yes');
    expect(answer(result, TIMEOUT_TSQ_FIRST)).toBe('yes');
    expect(answer(result, TIMEOUT_BOOKED_ONCE)).toBe('yes');
    expect(result.values).toMatchObject({
      timeout_submit_http_status: null,
      timeout_resend_attempts: 0,
      timeout_disposition: 'settled',
      timeout_rows_with_reference: 1,
      timeout_main_delta_kobo: -AMOUNTS_KOBO.s8TimeoutTransfer,
    });
    // Every status check came after the one and only submit.
    const calls = h.mock.calls;
    const submit = calls.findLastIndex(
      (c) => c.method === 'POST' && c.pathname === '/api/v1/transfer/wallet'
    );
    expect(
      calls
        .slice(submit + 1)
        .some((c) => c.pathname.endsWith('/transaction/verify'))
    ).toBe(true);
  });

  it('treats a 404 right after submit as uncertain: it keeps checking and never resends', async () => {
    const { h, result, before } = await run({ mock: { tsqNotFoundPolls: 2 } });
    expect(answer(result, NOT_FOUND_UNCERTAIN)).toBe('yes');
    expect(result.values.timeout_not_found_checks).toBe(2);
    expect(result.values.timeout_disposition).toBe('settled');
    expect(posts(h)).toHaveLength(before + 1);
    expect(result.values.timeout_resend_attempts).toBe(0);
  });

  it('holds for reconciliation, still without a resend, when TSQ never answers', async () => {
    const { h, result, before } = await run({
      mock: { tsqNotFoundPolls: 99 },
      maxPolls: 3,
    });
    expect(result.values.timeout_disposition).toBe('hold_for_reconcile');
    expect(answer(result, NOT_FOUND_UNCERTAIN)).toBe('yes');
    expect(answer(result, TIMEOUT_BOOKED_ONCE)).toBe('unknown');
    expect(posts(h)).toHaveLength(before + 1);
    expect(result.status).toBe('inconclusive');
  });

  it('marks the 404 finding not applicable when no 404 was seen', async () => {
    const { result } = await run();
    expect(answer(result, NOT_FOUND_UNCERTAIN)).toBe('not_applicable');
  });

  it('does not run without a transport fault injector', async () => {
    const h = makeHarness();
    dispose = h.dispose;
    await setupScenario(h.ctx);
    const b = new ProofBuilder('p10', 'S8');
    const before = posts(h).length;
    await stepTimeoutRetry(
      { ...h.ctx, faults: undefined },
      b,
      h.state.mainWalletId as string,
      h.state.goalWalletId as string
    );
    expect(posts(h)).toHaveLength(before);
    expect(answer(b.build(h.ctx), TIMEOUT_INDETERMINATE)).toBe('unknown');
  });
});
