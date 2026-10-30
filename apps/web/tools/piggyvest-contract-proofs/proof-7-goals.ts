import { inheritanceAnswer } from './payout-analysis';
import { type GoalOwner, runGoalVariant } from './proof-7-goal-variants';
import { answerOf, type ProofBuilder } from './proof-builder';
import type { ProofContext } from './proof-context';
import type { Answer } from './types';

/**
 * Proof 7, part 3: a goal sub-wallet with its own payout left unset (does it
 * inherit the customer's payout wallet?) and one with an explicit payout (is
 * the parameter accepted on POST /wallet/sub-account?). Answers come from the
 * variants' own readbacks, which are polled and never turn an unread wallet
 * into a "no".
 */
export async function recordGoalWallets(
  ctx: ProofContext,
  b: ProofBuilder,
  owner: GoalOwner | null,
  business: string,
  mainDestinationPaths: readonly string[]
): Promise<void> {
  const { redactor } = ctx;
  if (owner) {
    const unset = await runGoalVariant(ctx, owner, business, {
      slot: 'p7/goal_unset',
      nameSuffix: `-p7unset-a${ctx.attempt}`,
      payoutWalletId: null,
    });
    const explicit = await runGoalVariant(ctx, owner, business, {
      slot: 'p7/goal_explicit',
      nameSuffix: `-p7explicit-a${ctx.attempt}`,
      payoutWalletId: business,
    });
    const unsetInherits: Answer = inheritanceAnswer(
      unset.readback,
      mainDestinationPaths
    );
    b.finding(
      'goal_without_payout_created',
      'Is a goal sub-wallet with its own payout left unset created?',
      answerOf(unset.exists)
    );
    b.finding(
      'goal_without_payout_inherits_business_payout',
      "Does a goal wallet with no payout of its own inherit the customer's business payout wallet?",
      unsetInherits,
      unsetInherits === 'unknown'
        ? 'the readback omits a payout destination to compare, so inheritance cannot be determined'
        : undefined
    );
    b.finding(
      'goal_explicit_payout_accepted',
      'Does POST /wallet/sub-account accept interest_payout_wallet?',
      answerOf(explicit.accepted)
    );
    b.finding(
      'goal_explicit_readback_names_payout_destination',
      'Does the explicit goal wallet readback name that payout wallet?',
      explicit.readback === null
        ? 'unknown'
        : answerOf(explicit.readback.matchesTarget.length > 0)
    );
    b.value(
      'goal_explicit_error_message',
      explicit.errorMessage ? redactor.message(explicit.errorMessage) : null
    );
    b.value('goal_explicit_http_status', explicit.httpStatus);
    b.value(
      'goal_unset_error_message',
      unset.errorMessage ? redactor.message(unset.errorMessage) : null
    );
    for (const variant of [unset, explicit]) {
      if (variant.resumedOutcome) {
        b.inconclusive('a sub-wallet slot was already executed');
        b.note(
          `A sub-wallet slot was already used (${variant.resumedOutcome}); it is never resent. Use --new-attempt to repeat it.`
        );
      }
    }
    if (unsetInherits === 'yes') {
      b.note(
        'A goal wallet with no payout of its own INHERITS the customer payout wallet: goal interest would reach Ogabassey. Goal wallets must set their payout explicitly.'
      );
    }
  } else {
    for (const id of [
      'goal_without_payout_created',
      'goal_without_payout_inherits_business_payout',
      'goal_explicit_payout_accepted',
      'goal_explicit_readback_names_payout_destination',
    ]) {
      b.finding(
        id,
        id.replaceAll('_', ' '),
        'unknown',
        'no QA customer available'
      );
    }
  }
}
