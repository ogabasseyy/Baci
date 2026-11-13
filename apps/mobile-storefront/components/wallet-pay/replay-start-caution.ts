import type {
  WalletPayAdapter,
  WalletPayOutcomeKind,
} from './wallet-pay.types';

type StartAnswer<Result> = Awaited<
  ReturnType<WalletPayAdapter<Result>['start']>
>;

// Answers that prove nothing about a payment the earlier attempt may have
// sent: on a replayed key they must never say "nothing was taken".
const AMBIGUOUS = new Set<WalletPayOutcomeKind>([
  'sign_in',
  'unavailable',
  'not_started',
]);

/**
 * Runs a start on a purchase key. When the key was already saved (a replay
 * of an earlier attempt, whose payment may have gone through), an ambiguous
 * failure, or a throw, is marked as possibly paid, so the customer is told
 * not to pay again (Codex P2).
 */
export async function startWithReplayCaution<Result>(
  replayed: boolean,
  start: () => Promise<StartAnswer<Result>>
): Promise<StartAnswer<Result>> {
  let answer: StartAnswer<Result>;
  try {
    answer = await start();
  } catch (error) {
    if (!replayed) throw error;
    return {
      kind: 'outcome',
      outcome: { kind: 'not_started', maybePaid: true },
    };
  }
  if (
    replayed &&
    answer.kind === 'outcome' &&
    AMBIGUOUS.has(answer.outcome.kind)
  )
    return {
      kind: 'outcome',
      outcome: { ...answer.outcome, maybePaid: true },
    };
  return answer;
}
