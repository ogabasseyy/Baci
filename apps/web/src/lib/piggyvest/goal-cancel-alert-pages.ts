/**
 * Pages each alert, then records it as paged (acknowledges it), in order,
 * until the deadline: an alert left unpaged or unacknowledged at the deadline
 * is simply listed and paged again on the next run, never lost, and the rest
 * of the time budget is left for settling transfers. Returns how many
 * acknowledgements failed (each fails the run; its page repeats).
 */
export async function pageGoalCancelAlerts<T>(input: {
  items: readonly T[];
  emit: (item: T) => void;
  acknowledge: (item: T) => Promise<unknown>;
  deadlineAt?: number;
  now: () => number;
}): Promise<{ paged: number; failed: number }> {
  let paged = 0;
  let failed = 0;
  for (const item of input.items) {
    if (input.deadlineAt !== undefined && input.now() >= input.deadlineAt)
      break;
    input.emit(item);
    paged += 1;
    try {
      await input.acknowledge(item);
    } catch {
      failed += 1;
    }
  }
  return { paged, failed };
}
