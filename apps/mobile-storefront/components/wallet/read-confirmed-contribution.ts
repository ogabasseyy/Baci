/**
 * Reads what the server reported for a confirmed contribution: its
 * completion verdict and the goal balance after it, each only when the rail
 * returns one (the legacy manual API does; the PiggyVest rail does not).
 */
export function readConfirmedContribution(result: unknown): {
  goalCompleted?: boolean;
  savedAfter?: number;
} {
  if (typeof result !== 'object' || result === null) return {};
  const verdict: { goalCompleted?: boolean; savedAfter?: number } = {};
  if ('goalStatus' in result && typeof result.goalStatus === 'string') {
    verdict.goalCompleted = result.goalStatus === 'completed';
  }
  if (
    'goalCurrentAmount' in result &&
    typeof result.goalCurrentAmount === 'number' &&
    Number.isFinite(result.goalCurrentAmount)
  ) {
    verdict.savedAfter = result.goalCurrentAmount;
  }
  return verdict;
}
