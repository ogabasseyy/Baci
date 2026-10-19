export function isFatalDependencyError(
  error: Error | null | undefined,
  hasCachedData: boolean
): error is Error {
  return Boolean(error && !hasCachedData);
}

export function dependencyErrorMessage(
  branchesError: Error | null,
  groupsError: Error | null
): string | null {
  if (branchesError) return 'Could not load branches. Please try again.';
  if (groupsError) return 'Could not load expense groups. Please try again.';
  return null;
}

export function findHistoricalGroup<
  T extends { id: string; archived_at: string | null },
>(groups: readonly T[], groupId: string | null): T | undefined {
  return groups.find(
    ({ id, archived_at }) => id === groupId && archived_at !== null
  );
}

export function formDisabled(
  ...states: Array<boolean | Error | null>
): boolean {
  return states.some(Boolean);
}
