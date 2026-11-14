import { AMOUNTS_KOBO } from './constants';
import { measureDeposit } from './deposit-measure';
import { admitHouseWallet, houseRefusalReason } from './house-wallet';
import { pickString } from './loose-schemas';
import type { ProofBuilder } from './proof-builder';
import type { ProofContext } from './proof-context';
import { relationOfCredit } from './tsq-analysis';

/**
 * Proof 3, added step: the shape of an inflow into Ogabassey's house wallet
 * (float funding), so the worker can class it as treasury and never as a
 * customer credit. The business sandbox wallet stands in for the house
 * wallet only once admitted (house-wallet.ts); test funding stands in for a
 * bank transfer into its account.
 */

const QUESTIONS: ReadonlyArray<readonly [string, string]> = [
  [
    'house_inflow_credited',
    'Is a test deposit into the house wallet credited to it?',
  ],
  [
    'house_inflow_row_listed',
    'Does the house wallet transaction list show the credit row?',
  ],
];

function allUnknown(b: ProofBuilder, reason: string): void {
  b.inconclusive(reason);
  for (const [id, question] of QUESTIONS) b.finding(id, question, 'unknown');
}

export async function runHouseInflow(
  ctx: ProofContext,
  b: ProofBuilder
): Promise<void> {
  b.unobservable(
    'house_inflow_webhook_shape',
    'What does the inflow webhook for a deposit into the house wallet carry (so it is classed as treasury)?',
    'The harness has no receiver. Confirm from the durable inbox.'
  );
  const admission = await admitHouseWallet(ctx);
  const known =
    admission.binding === 'unbound' || admission.binding === 'bound';
  b.finding(
    'house_wallet_unbound_to_customer',
    'Is the configured business wallet bound to no API customer (so it can stand in for the house wallet)?',
    admission.binding === 'unbound'
      ? 'yes'
      : admission.binding === 'bound'
        ? 'no'
        : 'unknown',
    known ? undefined : houseRefusalReason(admission)
  );
  if (!admission.walletId) return allUnknown(b, houseRefusalReason(admission));

  b.note(
    'Assumption: test funding (POST /transfer/test/funding) into the business sandbox wallet stands in for a bank transfer into the house wallet.'
  );
  const gross = AMOUNTS_KOBO.fundHouse;
  const m = await measureDeposit(
    ctx,
    admission.walletId,
    gross,
    'p3/fund_house'
  );
  if (m.kind === 'resumed') {
    b.note(
      `The house funding slot was already used (${m.priorOutcome}); it is never resent. Use --new-attempt to repeat it.`
    );
    return allUnknown(b, 'house funding already executed in an earlier run');
  }
  b.value('house_funding_http_status', m.fundingHttpStatus).value(
    'house_funding_outcome',
    m.fundingOutcome
  );
  if (m.kind === 'unsettled') return allUnknown(b, m.reason);

  b.finding(QUESTIONS[0][0], QUESTIONS[0][1], 'yes');
  b.finding(
    QUESTIONS[1][0],
    QUESTIONS[1][1],
    m.row ? 'yes' : 'unknown',
    m.rowDetail ?? undefined
  );
  if (!m.row) b.inconclusive('the house-wallet deposit row was not observed');
  b.value('house_inflow_row_type', pickString(m.row, ['type']))
    .value('house_inflow_row_category', pickString(m.row, ['category']))
    .value('house_inflow_row_status', pickString(m.row, ['status']));
  b.shape(
    'GET /transaction (house wallet credit row)',
    m.listHttpStatus,
    m.row ?? undefined
  );
  if (m.single)
    b.shape(
      'GET /transaction/:id (house wallet deposit)',
      m.single.httpStatus,
      m.single.data
    );
  b.value('house_inflow_fee_kobo', m.facts.feeKobo).value(
    'house_credit_relation',
    relationOfCredit(gross, m.creditedKobo, m.facts.feeKobo)
  );
}
