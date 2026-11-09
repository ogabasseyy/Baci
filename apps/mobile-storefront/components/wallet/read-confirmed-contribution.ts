/**
 * Reads what the server reported for a confirmed contribution: whether the
 * goal is now complete, and the goal balance after it when the rail returns
 * one (the legacy manual API does; the PiggyVest rail does not).
 */
export function readConfirmedContribution(result: unknown): {
  goalCompleted: boolean;
  savedAfter?: number;
} {
  if (typeof result !== 'object' || result === null) {
    return { goalCompleted: false };
  }
  const goalCompleted =
    'goalStatus' in result && result.goalStatus === 'completed';
  const savedAfter =
    'goalCurrentAmount' in result &&
    typeof result.goalCurrentAmount === 'number' &&
    Number.isFinite(result.goalCurrentAmount)
      ? result.goalCurrentAmount
      : undefined;
  return savedAfter === undefined
    ? { goalCompleted }
    : { goalCompleted, savedAfter };
}
