import { AppState } from 'react-native';

type AuthRefreshController = {
  startAutoRefresh: () => void;
  stopAutoRefresh: () => void;
};

let activeAuth: AuthRefreshController | null = null;
let activeCleanup: (() => void) | null = null;

function syncRefreshState(
  auth: AuthRefreshController,
  state: typeof AppState.currentState
): void {
  if (state === 'active') {
    auth.startAutoRefresh();
    return;
  }

  auth.stopAutoRefresh();
}

export function registerAuthRefreshLifecycle(
  auth: AuthRefreshController
): () => void {
  if (activeAuth === auth && activeCleanup) {
    return activeCleanup;
  }

  if (activeCleanup) {
    activeCleanup();
  }

  const currentState =
    typeof AppState.currentState === 'string'
      ? AppState.currentState
      : 'active';

  syncRefreshState(auth, currentState);

  const subscription = AppState.addEventListener('change', (state) => {
    syncRefreshState(auth, state);
  });

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) {
      return;
    }

    cleaned = true;
    subscription.remove();
    auth.stopAutoRefresh();
    if (activeCleanup === cleanup) {
      activeAuth = null;
      activeCleanup = null;
    }
  };

  activeAuth = auth;
  activeCleanup = cleanup;

  return cleanup;
}
