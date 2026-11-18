// Bounds how long a quiz request waits on something it can do without
// (the shared session-check store, Supabase Auth on the answer path).

export const DEADLINE_PASSED = Symbol('deadline passed');

/**
 * Resolves with the work's result, or with DEADLINE_PASSED once `deadlineMs`
 * has gone by. The work itself is not cancelled and may still finish later.
 */
export function withinDeadline<T>(
  work: Promise<T>,
  deadlineMs: number
): Promise<T | typeof DEADLINE_PASSED> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<typeof DEADLINE_PASSED>((resolve) => {
    timer = setTimeout(() => resolve(DEADLINE_PASSED), deadlineMs);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}
