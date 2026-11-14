import { afterEach, describe, expect, it, vi } from 'vitest';
import { AMOUNTS_KOBO } from './constants';
import {
  stepTimeoutRetry,
  TIMEOUT_BOOKED_ONCE,
} from './proof-10-timeout-retry';
import { ProofBuilder } from './proof-builder';
import { setupScenario } from './scenario';
import { makeHarness } from './test-harness.test-support';

let dispose: (() => void) | null = null;
afterEach(() => {
  dispose?.();
  vi.restoreAllMocks();
});

/** Repeats every list row once, as a fee leg or a paging duplicate would. */
function duplicateRows(data: unknown): unknown {
  const top = data as {
    paginatedPayload?: { edges?: unknown[] };
    edges?: unknown[];
  };
  const holder = top.paginatedPayload ?? top;
  if (Array.isArray(holder.edges))
    holder.edges = [...holder.edges, ...holder.edges];
  else if (Array.isArray(data)) return [...data, ...data];
  return data;
}

/**
 * Books the transfer once, then shows a second list row under the same
 * reference, optionally with a second debit on the balances.
 */
async function withSecondRow(extraDebit: number) {
  const h = makeHarness();
  dispose = h.dispose;
  await setupScenario(h.ctx);
  const main = h.state.mainWalletId as string;
  const mainWallet = h.mock.sandbox.wallet(main);
  const realList = h.ctx.api.transactions.bind(h.ctx.api);
  h.ctx.api.transactions = async (...args: Parameters<typeof realList>) => {
    const out = await realList(...args);
    return { ...out, data: duplicateRows(out.data) };
  };
  const realVerify = h.ctx.api.verify.bind(h.ctx.api);
  let debited = false;
  h.ctx.api.verify = async (...args: Parameters<typeof realVerify>) => {
    const out = await realVerify(...args);
    if (mainWallet && !debited && out.httpStatus === 200) {
      debited = true;
      mainWallet.balance -= extraDebit;
    }
    return out;
  };
  const b = new ProofBuilder('p10', 'S8');
  await stepTimeoutRetry(h.ctx, b, main, h.state.goalWalletId as string);
  return b.build(h.ctx);
}
const answerOf = (r: { findings: { id: string; answer: string }[] }) =>
  r.findings.find((f) => f.id === TIMEOUT_BOOKED_ONCE);

describe('S8 timeout: list rows that disagree with the balances', () => {
  it('answers unknown, not no, for two rows but a single-transfer delta', async () => {
    const result = await withSecondRow(0);
    expect(result.values.timeout_rows_with_reference).toBe(2);
    const finding = answerOf(result);
    expect(finding?.answer).toBe('unknown');
    expect(JSON.stringify(finding)).toContain(
      'the transaction list shows 2 rows for the reference but the balances show one transfer; human review'
    );
  });

  it('answers no for two rows and a double-debit delta', async () => {
    const result = await withSecondRow(AMOUNTS_KOBO.s8TimeoutTransfer);
    expect(result.values.timeout_rows_with_reference).toBe(2);
    expect(answerOf(result)?.answer).toBe('no');
  });
});
