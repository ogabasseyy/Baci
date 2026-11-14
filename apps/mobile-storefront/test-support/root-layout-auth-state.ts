export function createRootLayoutAuthState(
  cleanup: () => void,
  initialize: () => void
) {
  return {
    cleanup,
    initialize,
    isInitialized: true,
    merchantId: null as string | null,
    user: null as { id: string } | null,
  };
}
