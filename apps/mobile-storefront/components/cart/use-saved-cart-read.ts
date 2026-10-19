import { useEffect, useState } from 'react';

export interface SavedCartReadScope {
  userId: string | null;
  generation: number;
}

export type SavedCartReadState = {
  scope: SavedCartReadScope | null;
  status: 'loading' | 'ready' | 'error';
};

/**
 * Saved-cart read state machine: loads the account's saved cart for the
 * committed owner scope, keeps the scope with the outcome so stale
 * completions never enable choices for a new owner, and retries on
 * demand.
 */
export function useSavedCartRead({
  userId,
  loadSavedCart,
  accountsEnabled,
  ownerScope,
  onStart,
}: {
  userId: string | null;
  loadSavedCart: (() => Promise<void>) | null;
  accountsEnabled: boolean;
  ownerScope: SavedCartReadScope;
  /** Runs when a new read starts (e.g. to invalidate merge picks). */
  onStart?: () => void;
}): {
  savedRead: SavedCartReadState;
  setSavedRead: (next: SavedCartReadState) => void;
  retrySavedRead: () => void;
} {
  const [savedRead, setSavedRead] = useState<SavedCartReadState>({
    scope: null,
    status: 'loading',
  });
  const [readRetry, setReadRetry] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the retry counter explicitly restarts a failed saved-cart read.
  useEffect(() => {
    if (!userId || !loadSavedCart || !accountsEnabled) return;
    let active = true;
    const scope = ownerScope;
    setSavedRead({ scope, status: 'loading' });
    onStart?.();
    void loadSavedCart().then(
      () => {
        if (active) setSavedRead({ scope, status: 'ready' });
      },
      () => {
        if (active) setSavedRead({ scope, status: 'error' });
      }
    );
    return () => {
      active = false;
    };
  }, [userId, loadSavedCart, accountsEnabled, readRetry, ownerScope]);

  return {
    savedRead,
    setSavedRead,
    retrySavedRead: () => setReadRetry((value) => value + 1),
  };
}
