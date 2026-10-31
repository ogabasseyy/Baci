import { AMOUNTS_KOBO } from './constants';
import {
  awaitTerminal,
  delta,
  readAllWallets,
  type TerminalWatch,
} from './poll';
import { answerOf, ProofBuilder } from './proof-builder';
import type { ProofContext } from './proof-context';
import type { Answer, ProofResult } from './types';

const TITLE = 'Withdrawal counter (wallet-to-wallet vs bank outflow)';
type Counts = Map<string, number | null>;

async function readCounts(ctx: ProofContext): Promise<Counts> {
  const counts: Counts = new Map();
  for (const [id, reading] of await readAllWallets(ctx))
    counts.set(id, reading.withdrawalCount);
  return counts;
}

function label(ctx: ProofContext, walletId: string): string {
  const role =
    ctx.state.wallets.find((wallet) => wallet.id === walletId)?.role ?? 'other';
  return `${role}_${ctx.redactor.pseudonym(walletId) ?? 'W?'}`;
}

function deltasOf(before: Counts, after: Counts): Map<string, number | null> {
  const out = new Map<string, number | null>();
  for (const [id, count] of before)
    out.set(id, delta(count, after.get(id) ?? null));
  return out;
}

function recordDeltas(
  b: ProofBuilder,
  ctx: ProofContext,
  prefix: string,
  deltas: Map<string, number | null>
) {
  for (const [id, value] of deltas)
    b.value(`${prefix}_${label(ctx, id)}`, value);
}

const changed = (deltas: Map<string, number | null>) =>
  [...deltas.entries()]
    .filter(([, value]) => (value ?? 0) > 0)
    .map(([id]) => id);
const known = (deltas: Map<string, number | null>) =>
  [...deltas.values()].every((value) => value !== null);

const signature = (counts: Counts) =>
  [...counts.entries()]
    .map(([id, count]) => `${id}=${count}`)
    .sort()
    .join('|');

interface CountsReading {
  counts: Counts;
  /** Nothing moved on any wallet in the final round of the polling budget. */
  settled: boolean;
}

/**
 * Reads every wallet's counter for the whole polling budget after a transfer
 * went through. Counters can become visible on different wallets at different
 * times, so two equal snapshots do not show that the others have settled, and
 * no early exit is taken: the reading is "settled" only if nothing moved in the
 * final round. A change still arriving then (or an unreadable wallet) leaves
 * the measurement unsettled and the caller reports `unknown`. The next
 * measurement starts from this reading, never from a mid-update one.
 */
async function settledCounts(
  ctx: ProofContext,
  expectChange: boolean
): Promise<CountsReading> {
  let current = await readCounts(ctx);
  if (!expectChange) return { counts: current, settled: false };
  let movedInFinalRound = true;
  for (let poll = 0; poll < ctx.maxPolls; poll += 1) {
    await ctx.sleep(ctx.pollIntervalMs);
    const next = await readCounts(ctx);
    movedInFinalRound = signature(next) !== signature(current);
    current = next;
  }
  return { counts: current, settled: ctx.maxPolls > 0 && !movedInFinalRound };
}

export async function runProof4(ctx: ProofContext): Promise<ProofResult> {
  const { api, qa, state, mode, redactor } = ctx;
  const b = new ProofBuilder('p4', TITLE);
  const main = state.mainWalletId;
  const goal = state.goalWalletId;
  if (state.wallets.length === 0)
    return b.inconclusive('QA wallets unavailable').build(ctx);

  const base = await readCounts(ctx);
  for (const [id, count] of base)
    b.value(`baseline_count_${label(ctx, id)}`, count);
  b.value('wallets_read', base.size);
  b.value('counter_settle_polls', ctx.maxPolls);
  if (mode === 'live-readonly' || !main || !goal) {
    b.inconclusive(
      mode === 'live-readonly'
        ? 'transfers need --live-sandbox-mutations'
        : 'main/goal wallets unavailable'
    );
    b.finding(
      'w2w_changes_counter',
      'Does a wallet-to-wallet transfer change withdrawal_count on any wallet?',
      'unknown'
    );
    b.finding(
      'bank_outflow_changes_counter',
      'Does a bank outflow from the main wallet change withdrawal_count?',
      'unknown'
    );
    return b.build(ctx);
  }

  // (a) wallet-to-wallet
  let afterW2w: CountsReading = { counts: base, settled: false };
  const w2w = await api.transferWallet(
    qa,
    main,
    goal,
    AMOUNTS_KOBO.walletTransfer,
    'p4/w2w'
  );
  redactor.register('R', w2w.reference);
  let w2wWatch: TerminalWatch | null = null;
  if (w2w.kind === 'resumed') {
    b.inconclusive('wallet transfer already executed in an earlier run');
    b.note(
      `The wallet-transfer slot was already used (${w2w.priorOutcome}); it is never resent. Use --new-attempt to repeat it.`
    );
  } else {
    w2wWatch = await awaitTerminal(ctx, w2w.reference, main);
    b.value('w2w_terminal', w2wWatch.terminal);
    afterW2w = await settledCounts(ctx, w2wWatch.terminal === 'success');
  }
  const w2wDeltas = deltasOf(base, afterW2w.counts);
  recordDeltas(b, ctx, 'w2w_delta', w2wDeltas);
  const w2wSettled =
    w2wWatch?.terminal === 'success' && known(w2wDeltas) && afterW2w.settled;
  // The bank baseline is only clean if the wallet transfer's effects are all in
  // it, or the transfer demonstrably had none.
  const baselineClean =
    w2wSettled ||
    (w2w.kind === 'sent' && w2w.outcome === 'rejected') ||
    w2wWatch?.terminal === 'failed';
  b.finding(
    'w2w_changes_counter',
    'Does a wallet-to-wallet transfer change withdrawal_count on any wallet?',
    w2wSettled ? answerOf(changed(w2wDeltas).length > 0) : 'unknown',
    w2wSettled
      ? undefined
      : 'transfer did not reach a successful terminal state, or its counters had not settled, in this run'
  );

  // (b) bank outflow from the main wallet
  const bankFinding = (answer: Answer, detail?: string) =>
    b.finding(
      'bank_outflow_changes_counter',
      'Does a bank outflow from the main wallet change withdrawal_count?',
      answer,
      detail
    );
  if (!ctx.bank) {
    b.inconclusive('no sandbox bank destination configured');
    b.value('counter_scope', 'unknown');
    bankFinding(
      'unknown',
      'set PVB_PROOF_BANK_CODE and PVB_PROOF_BANK_ACCOUNT to a sandbox destination'
    );
    return b.build(ctx);
  }
  redactor.register('B', ctx.bank.account);
  redactor.register('B', ctx.bank.code);
  const bank = await api.transferBank(
    qa,
    main,
    { bankCode: ctx.bank.code, accountNumber: ctx.bank.account },
    AMOUNTS_KOBO.bankOutflow,
    'p4/bank_out'
  );
  redactor.register('R', bank.reference);
  if (bank.kind === 'resumed') {
    b.inconclusive('bank outflow already executed in an earlier run');
    b.note(
      `The bank-outflow slot was already used (${bank.priorOutcome}); it is never resent. Use --new-attempt to repeat it.`
    );
    b.value('counter_scope', 'unknown');
    bankFinding('unknown', 'slot already executed');
    return b.build(ctx);
  }
  b.value('bank_http_status', bank.call.httpStatus).value(
    'bank_outcome',
    bank.outcome
  );
  const bankWatch = await awaitTerminal(ctx, bank.reference, main);
  b.value('bank_terminal', bankWatch.terminal);
  const afterBank = await settledCounts(ctx, bankWatch.terminal === 'success');
  const bankDeltas = deltasOf(afterW2w.counts, afterBank.counts);
  recordDeltas(b, ctx, 'bank_delta', bankDeltas);
  const bankSettled =
    bankWatch.terminal === 'success' &&
    known(bankDeltas) &&
    afterBank.settled &&
    baselineClean;
  const moved = changed(bankDeltas);
  bankFinding(
    bankSettled ? answerOf(moved.length > 0) : 'unknown',
    bankSettled
      ? undefined
      : 'bank outflow did not reach a successful terminal state, or the counters (or the wallet-transfer baseline) had not settled, in this run'
  );
  b.value(
    'counter_scope',
    !bankSettled || moved.length === 0
      ? 'unknown'
      : moved.length === 1 && moved[0] === main
        ? 'per_wallet'
        : moved.length > 1
          ? 'per_customer'
          : 'unknown'
  );
  if (!bankSettled || !w2wSettled)
    b.inconclusive(
      'a transfer did not reach a successful terminal state, or its counters did not settle'
    );
  state.bankTransfer = {
    kind: 'bank',
    amountKobo: AMOUNTS_KOBO.bankOutflow,
    terminal: bankWatch.terminal,
    sourceDeltaKobo: null,
    destinationDeltaKobo: null,
    feeFromRecordKobo: null,
    feeFieldPresent: null,
  };
  return b.build(ctx);
}
