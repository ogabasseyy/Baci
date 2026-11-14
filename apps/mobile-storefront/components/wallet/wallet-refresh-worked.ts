/**
 * Runs a wallet refresh and says whether it worked. TanStack Query's
 * `refetch` usually resolves with `{ isError: true }` on failure instead of
 * rejecting, so both shapes count as a failed refresh.
 */
export async function walletRefreshWorked(
  refresh: () => Promise<unknown>
): Promise<boolean> {
  try {
    const result = await refresh();
    return !(
      typeof result === 'object' &&
      result !== null &&
      'isError' in result &&
      (result as { isError?: unknown }).isError === true
    );
  } catch {
    return false;
  }
}
