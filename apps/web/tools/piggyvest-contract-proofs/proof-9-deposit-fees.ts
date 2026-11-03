import { AMOUNTS_KOBO } from './constants';
import { measureDeposit } from './deposit-measure';
import { answerOf, ProofBuilder } from './proof-builder';
import type { ProofContext } from './proof-context';
import { relationOfCredit } from './tsq-analysis';
import type { Answer, ProofResult } from './types';

const TITLE = 'Deposit fee mechanics on main and goal wallets';

/**
 * Proof 9: for a main-wallet deposit (made here) and the goal-wallet deposit
 * proof 3 made, what does the record carry (gross, fee, net) and how does it
 * relate to the measured balance change? If the sandbox charges no deposit
 * fee, whether a fee would be netted from the credit is recorded as unproven.
 */

interface Deposit {
  grossKobo: number;
  creditedKobo: number;
  feeKobo: number | null;
}

const MONEY_FIELD = /amount|fee|gross|net|charge|vat|settle/i;

type Binding =
  | 'net_of_fee'
  | 'gross_fee_billed_elsewhere'
  | 'mixed'
  | 'unproven_zero_fee'
  | 'unknown';

export function bindingOf(deposits: ReadonlyArray<Deposit | null>): Binding {
  if (deposits.some((d) => d === null || d.feeKobo === null)) return 'unknown';
  const charged = (deposits as Deposit[]).filter((d) => (d.feeKobo ?? 0) > 0);
  if (charged.length === 0) return 'unproven_zero_fee';
  const relations = new Set(
    charged.map((d) => relationOfCredit(d.grossKobo, d.creditedKobo, d.feeKobo))
  );
  if (relations.size !== 1) return 'mixed';
  const [only] = relations;
  return only === 'net_of_fee'
    ? 'net_of_fee'
    : only === 'gross'
      ? 'gross_fee_billed_elsewhere'
      : 'mixed';
}

const NETTED_QUESTION =
  'When a deposit carries a fee, is the wallet credited the gross minus that fee?';
const MAIN_QUESTIONS: ReadonlyArray<readonly [string, string]> = [
  ['main_deposit_credited', 'Is a test deposit into the main wallet credited?'],
  [
    'main_deposit_record_shows_fee',
    'Does the main deposit record carry a fee field?',
  ],
  [
    'main_deposit_record_amount_is_gross',
    'Is the main deposit record amount the gross deposited?',
  ],
];

async function measureMain(
  ctx: ProofContext,
  b: ProofBuilder,
  main: string
): Promise<Deposit | null> {
  const gross = AMOUNTS_KOBO.depositMain;
  const unknown = (reason: string) => {
    b.inconclusive(reason);
    for (const [id, question] of MAIN_QUESTIONS)
      b.finding(id, question, 'unknown');
    return null;
  };
  const m = await measureDeposit(ctx, main, gross, 'p9/fund_main');
  if (m.kind === 'resumed') {
    b.note(
      `The main deposit slot was already used (${m.priorOutcome}); it is never resent. Use --new-attempt to repeat it.`
    );
    return unknown('main deposit already executed in an earlier run');
  }
  b.value('main_funding_http_status', m.fundingHttpStatus);
  if (m.kind === 'unsettled') return unknown(m.reason);
  const { record, facts } = m;
  b.finding(MAIN_QUESTIONS[0][0], MAIN_QUESTIONS[0][1], 'yes');
  if (!record) b.inconclusive(m.rowDetail ?? 'the deposit record was not read');
  b.finding(
    MAIN_QUESTIONS[1][0],
    MAIN_QUESTIONS[1][1],
    record ? answerOf(facts.hasFee) : 'unknown'
  );
  b.finding(
    MAIN_QUESTIONS[2][0],
    MAIN_QUESTIONS[2][1],
    record ? answerOf(facts.amountMatches) : 'unknown'
  );
  if (m.single)
    b.shape(
      'GET /transaction/:id (main deposit)',
      m.single.httpStatus,
      m.single.data
    );
  b.value(
    'main_deposit_record_money_fields',
    record
      ? Object.keys(record)
          .filter((key) => MONEY_FIELD.test(key))
          .sort()
          .join(',') || null
      : null
  );
  b.value('main_deposit_fee_kobo', facts.feeKobo).value(
    'main_credit_relation',
    relationOfCredit(gross, m.creditedKobo, facts.feeKobo)
  );
  return record
    ? { grossKobo: gross, creditedKobo: m.creditedKobo, feeKobo: facts.feeKobo }
    : null;
}

export async function runProof9(ctx: ProofContext): Promise<ProofResult> {
  const b = new ProofBuilder('p9', TITLE);
  const { state, mode } = ctx;
  b.unobservable(
    'deposit_event_gross_fee_net',
    'Does the bank-inflow webhook carry the gross amount, the fee and the net credit?',
    'The harness has no webhook receiver. Confirm from the durable inbox.'
  );
  const main = state.mainWalletId;
  if (mode === 'live-readonly' || !main)
    return b
      .inconclusive(
        mode === 'live-readonly'
          ? 'the main deposit needs --live-sandbox-mutations'
          : 'QA main wallet unavailable'
      )
      .build(ctx);
  const mainDeposit = await measureMain(ctx, b, main);

  const g = state.deposit;
  const goalDeposit: Deposit | null =
    g && g.creditedKobo !== null && g.creditedKobo > 0
      ? {
          grossKobo: g.grossKobo,
          creditedKobo: g.creditedKobo,
          feeKobo: g.feeFromRecordKobo,
        }
      : null;
  b.finding(
    'goal_deposit_measured',
    'Was a goal-wallet deposit measured (proof 3)?',
    goalDeposit ? 'yes' : 'unknown',
    goalDeposit ? undefined : 'proof 3 did not measure a settled goal deposit'
  );
  b.value('goal_deposit_fee_kobo', goalDeposit?.feeKobo ?? null).value(
    'goal_credit_relation',
    goalDeposit
      ? relationOfCredit(
          goalDeposit.grossKobo,
          goalDeposit.creditedKobo,
          goalDeposit.feeKobo
        )
      : null
  );

  const binding = bindingOf([mainDeposit, goalDeposit]);
  b.value('deposit_fee_binding', binding);
  if (binding === 'unproven_zero_fee') {
    b.unobservable(
      'deposit_fee_netted_from_credit',
      NETTED_QUESTION,
      'the sandbox charged no deposit fee on either wallet, so whether a fee is netted from the credit is unproven'
    );
  } else {
    const answer: Answer =
      binding === 'net_of_fee'
        ? 'yes'
        : binding === 'gross_fee_billed_elsewhere'
          ? 'no'
          : 'unknown';
    b.finding(
      'deposit_fee_netted_from_credit',
      NETTED_QUESTION,
      answer,
      binding === 'mixed'
        ? 'the main and goal deposits did not relate to their fees the same way'
        : undefined
    );
  }
  return b.build(ctx);
}
