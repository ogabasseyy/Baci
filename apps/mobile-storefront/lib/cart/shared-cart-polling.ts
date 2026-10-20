import { AppState } from 'react-native';

/**
 * Background refresh cadence for the native shared cart: poll while
 * foregrounded with a snapshot, and refresh on every foreground
 * transition. Returns the teardown for both subscriptions.
 */
export function startSharedCartPolling(deps: {
  getController: () => { refresh: () => Promise<void> } | null;
  hasSnapshot: () => boolean;
}): () => void {
  const poll = setInterval(() => {
    const controller = deps.getController();
    if (AppState.currentState === 'active' && controller && deps.hasSnapshot())
      void controller.refresh().catch(() => undefined);
  }, 30000);
  const foreground = AppState.addEventListener('change', (state) => {
    const controller = deps.getController();
    if (state === 'active' && controller)
      void controller.refresh().catch(() => undefined);
  });
  return () => {
    foreground.remove();
    clearInterval(poll);
  };
}
