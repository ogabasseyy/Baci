/**
 * True when the signed-in account is still the one a money flow started for.
 * Lazy-loaded, like the card funding guard: a static auth-store import would
 * pull the storage and push chain into every importer of the wallet handlers.
 */
export function isSameSignedInUser(userId: string | undefined): boolean {
  if (!userId) return false;
  const { useAuthStore } =
    require('@/stores/auth-store') as typeof import('@/stores/auth-store');
  return useAuthStore.getState().user?.id === userId;
}
