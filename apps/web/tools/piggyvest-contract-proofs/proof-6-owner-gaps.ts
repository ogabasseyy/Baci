import { answerOf, type ProofBuilder } from './proof-builder';
import type { ProofContext } from './proof-context';
import { recordOf } from './read-rules';

/**
 * Proof 6, added step: the parts of the fee and restriction contract this
 * harness cannot exercise against the sandbox, recorded as such (they are
 * owner and PiggyVest questions, see the evidence document), plus the one
 * observable piece: which restriction flags a wallet readback carries.
 */

const RESTRICTION_FIELD = /lien|frozen|freeze|restrict/i;

const booleanOrNull = (value: unknown): boolean | null =>
  typeof value === 'boolean' ? value : null;

export async function runFeeBearerAndRestrictions(
  ctx: ProofContext,
  b: ProofBuilder
): Promise<void> {
  b.unobservable(
    'fee_wallet_bears_transfer_fee',
    'With the API transaction-fee setting pointing at a fee wallet (fee_wallet_id), does the fee wallet pay the wallet-transfer fee while the customer wallet is debited exactly the amount?',
    'The fee wallet is a PiggyVest business setting, not a request field, and the sandbox charges no wallet-transfer fee, so the payer cannot be observed here.'
  );
  b.unobservable(
    'restriction_webhook_payload',
    'What do the Lien and Freeze restriction webhooks carry (pvb_wallet vs eventData.wallet_id, available vs ledger balance)?',
    'PiggyVest places restrictions; the API offers no call to place one and the harness has no webhook receiver.'
  );
  b.unobservable(
    'restriction_blocks_business_transfer',
    'Does an active Lien or Freeze block a business-initiated transfer out of the wallet?',
    'No restriction can be placed on a sandbox wallet from the API.'
  );

  const main = ctx.state.mainWalletId;
  const record = main ? recordOf(await ctx.api.wallet(main)) : null;
  const flags = record
    ? Object.keys(record)
        .filter((key) => RESTRICTION_FIELD.test(key))
        .sort()
    : null;
  b.value(
    'wallet_restriction_field_names',
    flags && flags.length > 0 ? flags.join(',') : null
  );
  b.finding(
    'wallet_readback_shows_restriction_flags',
    'Does GET /wallet/:id carry restriction flags (lien / frozen)?',
    flags === null ? 'unknown' : answerOf(flags.length > 0),
    flags === null ? 'the main wallet could not be read' : undefined
  );
  if (record) {
    b.value('main_wallet_is_frozen', booleanOrNull(record.is_frozen)).value(
      'main_wallet_has_an_active_lien',
      booleanOrNull(record.has_an_active_lien)
    );
  }
}
