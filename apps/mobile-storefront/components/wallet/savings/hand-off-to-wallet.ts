import { showAppAlert } from '@/components/ui/show-app-alert';

export const PLAN_CREATED_HEAD_START_PENDING =
  'Your plan was created, but we could not load it yet. Open your wallet to add the head start.';

export const SIGN_IN_TO_START_SAVINGS_MESSAGE =
  'Sign in to start a savings plan.';
export const PLAN_ALREADY_CREATED_MESSAGE =
  'Your plan is already created. Open your wallet to add the head start, or leave this screen to start a different plan.';

type HandOffInput = {
  effectiveInitialContribution: number;
  onContinueInWallet?: (goalId: string, amount: number) => void;
  onHandOffPending?: (goalId: string) => void;
  refetch: () => Promise<unknown>;
  setFormError: (value: string | null) => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasGoalId(value: unknown, goalId: string): boolean {
  return isRecord(value) && value.id === goalId;
}

/** The wallet refetch succeeded and its data includes the plan by id. */
function walletHasGoal(refetchResult: unknown, goalId: string): boolean {
  if (!isRecord(refetchResult) || refetchResult.isError === true) return false;
  const data = refetchResult.data;
  const wallet = isRecord(data) ? data.wallet : undefined;
  if (!isRecord(wallet)) return false;
  const goals = wallet.savings_goals;
  return (
    hasGoalId(wallet.active_savings_goal, goalId) ||
    (Array.isArray(goals) && goals.some((goal) => hasGoalId(goal, goalId)))
  );
}

/**
 * Opens the wallet's Add to savings sheet for a created plan, prefilled with
 * the head start, but only once the reloaded wallet holds that plan: the
 * wallet falls back to an older active plan for an id it has not loaded.
 * Otherwise the plan is reported as pending, so a later submit retries this
 * hand-off for the same plan instead of creating another.
 */
export async function handOffToWallet(
  input: HandOffInput,
  goalId: string,
  isCurrent: () => boolean
): Promise<void> {
  // A failed refetch resolves with an error result rather than throwing,
  // so the reloaded data itself must contain the plan.
  let loaded = false;
  try {
    loaded = walletHasGoal(await input.refetch(), goalId);
  } catch {
    loaded = false;
  }
  if (!isCurrent()) return;
  if (!loaded) {
    input.onHandOffPending?.(goalId);
    input.setFormError(PLAN_CREATED_HEAD_START_PENDING);
    // The form stays open with no sheet, so say it where it is seen.
    showAppAlert({
      title: 'Plan created',
      message: PLAN_CREATED_HEAD_START_PENDING,
      variant: 'info',
    });
    return;
  }
  input.onContinueInWallet?.(goalId, input.effectiveInitialContribution);
}
