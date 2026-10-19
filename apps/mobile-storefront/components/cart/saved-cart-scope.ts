/**
 * Owner-scope equality by value: a recreated scope object for the same
 * owner and generation must still match a completed saved-cart read.
 */
export function savedCartScopeMatches(
  saved: { userId: string | null; generation: number } | null,
  owner: { userId: string | null; generation: number }
): boolean {
  return (
    saved?.userId === owner.userId && saved?.generation === owner.generation
  );
}
