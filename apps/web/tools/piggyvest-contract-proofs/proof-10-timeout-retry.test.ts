import { afterEach, describe, expect, it, vi } from 'vitest';
import { AMOUNTS_KOBO } from './constants';
import { MovementLedger } from './movement-ledger';
import { createMemoryJournal, type JournalEntry } from './mutation-journal';
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

async function run(
  options: Parameters<typeof makeHarness>[0] = {},
  earlierSettled = true
) {
  const h = makeHarness(options);
  dispose = h.dispose;
  await setupScenario(h.ctx);
  const b = new ProofBuilder('p10', 'S8');
  const before = posts(h).length;
  const ledger = new MovementLedger();
  if (!earlierSettled)
    ledger.append({
      from: null,
      to: h.state.mainWalletId as string,
      amountKobo: 1,
      settled: false,
    });
  await stepTimeoutRetry(
    h.ctx,
    b,
    h.state.mainWalletId as string,
    h.state.goalWalletId as string,
    ledger
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

  it('still counts a transfer booked once when the provider adds a fee', async () => {
    const { result } = await run({ mock: { transferFeeKobo: 100 } });
    expect(answer(result, TIMEOUT_BOOKED_ONCE)).toBe('yes');
  });

  it('answers unknown, not no, when the slot was already booked in an earlier run', async () => {
    const h = makeHarness();
    dispose = h.dispose;
    await setupScenario(h.ctx);
    const main = h.state.mainWalletId as string;
    const goal = h.state.goalWalletId as string;
    await stepTimeoutRetry(h.ctx, new ProofBuilder('p10', 'S8'), main, goal);
    const b = new ProofBuilder('p10', 'S8');
    const before = posts(h).length;
    await stepTimeoutRetry(h.ctx, b, main, goal);
    expect(posts(h)).toHaveLength(before);
    expect(answer(b.build(h.ctx), TIMEOUT_BOOKED_ONCE)).toBe('unknown');
  });

  it('waits for a lagging transaction list instead of publishing no', async () => {
    const { result } = await run({ mock: { listLagReads: 1 } });
    expect(answer(result, TIMEOUT_BOOKED_ONCE)).toBe('yes');
    expect(result.values.timeout_rows_with_reference).toBe(1);
  });

  it('answers unknown when the list never shows the reference within the budget', async () => {
    const { result } = await run({ mock: { listLagReads: 50 }, maxPolls: 3 });
    expect(answer(result, TIMEOUT_BOOKED_ONCE)).toBe('unknown');
    expect(result.values.timeout_rows_with_reference).toBeNull();
  });

  it('does not claim continued checking when the 404 was the last status check', async () => {
    const h = makeHarness({ mock: { tsqNotFoundPolls: 99 } });
    dispose = h.dispose;
    await setupScenario(h.ctx);
    const b = new ProofBuilder('p10', 'S8');
    await stepTimeoutRetry(
      { ...h.ctx, maxPolls: 0 },
      b,
      h.state.mainWalletId as string,
      h.state.goalWalletId as string
    );
    const result = b.build(h.ctx);
    expect(result.values.timeout_not_found_checks).toBe(1);
    expect(answer(result, NOT_FOUND_UNCERTAIN)).toBe('unknown');
  });

  async function bookedWithExtraDebit(
    extra: number,
    options: Parameters<typeof makeHarness>[0] = {}
  ) {
    const h = makeHarness(options);
    dispose = h.dispose;
    await setupScenario(h.ctx);
    const main = h.state.mainWalletId as string;
    const real = h.ctx.api.verify.bind(h.ctx.api);
    const mainWallet = h.mock.sandbox.wallet(main);
    let taken = false;
    h.ctx.api.verify = async (...args: Parameters<typeof real>) => {
      const out = await real(...args);
      if (mainWallet && !taken && out.httpStatus === 200) {
        taken = true;
        mainWallet.balance -= extra;
      }
      return out;
    };
    const b = new ProofBuilder('p10', 'S8');
    await stepTimeoutRetry(h.ctx, b, main, h.state.goalWalletId as string);
    return answer(b.build(h.ctx), TIMEOUT_BOOKED_ONCE);
  }

  it('answers unknown when the debit exceeds the amount and no fee was read', async () => {
    expect(await bookedWithExtraDebit(500)).toBe('unknown');
  });

  it('answers no when the recorded fee does not explain the extra debit', async () => {
    expect(
      await bookedWithExtraDebit(500, {
        mock: { tsqShape: 'rich', transferFeeKobo: 100 },
      })
    ).toBe('no');
  });
});

describe('S8 timeout slot resumed from the journal', () => {
  async function resumedWith(
    mutate: (entries: JournalEntry[]) => JournalEntry[]
  ) {
    const journal = createMemoryJournal();
    const first = makeHarness({ journal });
    await setupScenario(first.ctx);
    await stepTimeoutRetry(
      first.ctx,
      new ProofBuilder('p10', 'S8'),
      first.state.mainWalletId as string,
      first.state.goalWalletId as string
    );
    const sandbox = first.mock.sandbox;
    first.dispose();
    const h = makeHarness({
      journal: createMemoryJournal(mutate([...journal.entries()])),
    });
    dispose = h.dispose;
    h.mock.sandbox.adopt(sandbox);
    await setupScenario(h.ctx);
    const b = new ProofBuilder('p10', 'S8');
    const before = posts(h).length;
    await stepTimeoutRetry(
      h.ctx,
      b,
      h.state.mainWalletId as string,
      h.state.goalWalletId as string
    );
    expect(posts(h)).toHaveLength(before);
    return b.build(h.ctx);
  }
  const slotOutcome = (e: JournalEntry) =>
    e.phase === 'outcome' && e.slot.includes('timeout_submit');

  it('keeps yes when the journaled prior outcome is indeterminate', async () => {
    const r = await resumedWith((e) => e);
    expect(answer(r, TIMEOUT_INDETERMINATE)).toBe('yes');
  });

  it('answers unknown, not no, when the prior outcome was accepted', async () => {
    const r = await resumedWith((e) =>
      e.map((x) => (slotOutcome(x) ? { ...x, outcome: 'accepted' } : x))
    );
    expect(answer(r, TIMEOUT_INDETERMINATE)).toBe('unknown');
  });

  it('answers unknown, not no, when the prior run crashed before an outcome', async () => {
    const r = await resumedWith((e) => e.filter((x) => !slotOutcome(x)));
    expect(answer(r, TIMEOUT_INDETERMINATE)).toBe('unknown');
  });
});
