import { pickString } from './loose-schemas';
import { answerOf, ProofBuilder } from './proof-builder';
import type { ProofContext } from './proof-context';
import { recordOf, usableList } from './read-rules';
import { analyseRecord, relationOfCredit } from './tsq-analysis';
import type { ProofResult } from './types';

const TITLE = 'Fees on deposits and wallet transfers';
const HISTORY_WALLETS = 3;
const HISTORY_ROWS = 3;

/** Historical records: only successful reads of object records count. */
async function scanHistory(ctx: ProofContext, b: ProofBuilder): Promise<void> {
  let read = 0;
  let withFee = 0;
  let unreadableWallets = 0;
  const fees = new Set<number>();
  for (const wallet of ctx.state.wallets.slice(0, HISTORY_WALLETS)) {
    const list = usableList(
      await ctx.api.transactions({ wallet_id: wallet.id, limit: '5' })
    );
    if (!list) {
      unreadableWallets += 1;
      continue;
    }
    for (const row of list.edges.slice(0, HISTORY_ROWS)) {
      const id = pickString(row, ['id']);
      if (!id) continue;
      const record = recordOf(await ctx.api.transaction(id, wallet.id));
      if (!record) continue;
      const facts = analyseRecord(record, {
        sourceWalletId: null,
        destinationWalletId: null,
        amountKobo: null,
      });
      read += 1;
      if (facts.hasFee) withFee += 1;
      if (facts.feeKobo !== null) fees.add(facts.feeKobo);
    }
  }
  b.value('historical_records_read', read).value(
    'historical_records_with_fee_field',
    withFee
  );
  b.value('historical_wallets_unreadable', unreadableWallets);
  b.value(
    'historical_fee_values_kobo',
    [...fees].sort((a, c) => a - c).join(',') || null
  );
}

export async function runProof6(ctx: ProofContext): Promise<ProofResult> {
  const b = new ProofBuilder('p6', TITLE);
  const { deposit, walletTransfer: transfer } = ctx.state;

  if (deposit) {
    // With the fee unknown, a credit that is not the gross cannot be classified.
    const relation =
      deposit.feeFromRecordKobo === null &&
      deposit.creditedKobo !== deposit.grossKobo
        ? 'unknown'
        : relationOfCredit(
            deposit.grossKobo,
            deposit.creditedKobo,
            deposit.feeFromRecordKobo
          );
    b.value('deposit_fee_kobo', deposit.feeFromRecordKobo).value(
      'deposit_credit_relation',
      relation
    );
    b.value(
      'deposit_fee_borne_by',
      relation === 'net_of_fee'
        ? 'wallet (credited net of fee)'
        : relation === 'gross'
          ? 'not the wallet (credited gross)'
          : 'unknown'
    );
    b.finding(
      'deposit_fee_field_present',
      'Does the deposit record carry a fee field?',
      answerOf(deposit.feeFieldPresent),
      deposit.feeFieldPresent === null
        ? 'no deposit record could be read, so a missing fee field is not established'
        : undefined
    );
  } else {
    b.finding(
      'deposit_fee_field_present',
      'Does the deposit record carry a fee field?',
      'unknown',
      'no deposit was measured in this run (proof 3 needs mutation mode)'
    );
  }

  if (
    transfer &&
    transfer.terminal === 'success' &&
    transfer.sourceDeltaKobo !== null &&
    transfer.destinationDeltaKobo !== null
  ) {
    const fee = transfer.feeFromRecordKobo;
    const exact = transfer.sourceDeltaKobo === -transfer.amountKobo;
    const withFee =
      fee !== null &&
      fee > 0 &&
      transfer.sourceDeltaKobo === -(transfer.amountKobo + fee);
    b.value('transfer_fee_kobo', fee);
    b.finding(
      'transfer_fee_field_present',
      'Does the wallet-transfer record carry a fee field?',
      answerOf(transfer.feeFieldPresent),
      transfer.feeFieldPresent === null
        ? 'not every transfer record could be read, so a missing fee field is not established'
        : undefined
    );
    b.finding(
      'transfer_source_debited_exactly_amount',
      'Is the source wallet debited exactly the transfer amount?',
      answerOf(exact)
    );
    b.finding(
      'transfer_destination_credited_exactly_amount',
      'Is the destination wallet credited exactly the transfer amount?',
      answerOf(transfer.destinationDeltaKobo === transfer.amountKobo)
    );
    b.value(
      'transfer_fee_payer',
      withFee
        ? 'source wallet (debited amount plus fee)'
        : exact
          ? fee === null
            ? 'unknown (the fee was not read)'
            : fee > 0
              ? 'not the source wallet (source debited exactly the amount)'
              : 'none observed'
          : 'unknown'
    );
  } else {
    b.finding(
      'transfer_fee_field_present',
      'Does the wallet-transfer record carry a fee field?',
      'unknown',
      'no settled wallet transfer was measured in this run (proof 2 needs mutation mode)'
    );
  }

  await scanHistory(ctx, b);
  if (!deposit && !transfer) {
    b.inconclusive(
      'no deposit or transfer was measured; only historical records were read'
    );
  }
  b.note(
    'Fee tariffs seen here are sandbox values. Production tariffs and the fee-wallet configuration are separate confirmations.'
  );
  return b.build(ctx);
}
