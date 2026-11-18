/**
 * Pages every alert first (cheap, no I/O), stopping only at the deadline,
 * then acknowledges the paged ones in order while time remains. An alert
 * left unpaged or unacknowledged at the deadline is simply listed and paged
 * again on the next run, never lost, and a slow database can not spend the
 * budget before later alerts are paged or transfers are settled. Returns how
 * many were paged and how many acknowledgements failed (each fails the run;
 * its page repeats).
 */
export async function pageGoalCancelAlerts<T>(input: {
  items: readonly T[];
  emit: (item: T) => void;
  acknowledge: (item: T) => Promise<unknown>;
  deadlineAt?: number;
  now: () => number;
}): Promise<{ paged: number; failed: number }> {
  const pastDeadline = () =>
    input.deadlineAt !== undefined && input.now() >= input.deadlineAt;
  const paged: T[] = [];
  for (const item of input.items) {
    if (pastDeadline()) break;
    input.emit(item);
    paged.push(item);
  }
  let failed = 0;
  for (const item of paged) {
    if (pastDeadline()) break;
    try {
      await input.acknowledge(item);
    } catch {
      failed += 1;
    }
  }
  return { paged: paged.length, failed };
}
