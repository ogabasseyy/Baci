import { useEffect, useRef } from 'react';
import { useAuthStore } from '@/stores/auth-store';
import { useQuizStore } from '@/stores/quiz-store';

/**
 * Clears in-memory quiz state when the authenticated shopper changes while
 * leaving the previous shopper's persisted recovery envelope untouched.
 */
export function useQuizAccountChangeReset() {
  const authUserId = useAuthStore((state) => state.user?.id ?? null);
  const resetForAccountChange = useQuizStore(
    (state) => state.resetForAccountChange
  );
  const previousAuthUserIdRef = useRef(authUserId);

  useEffect(() => {
    if (previousAuthUserIdRef.current === authUserId) return;
    previousAuthUserIdRef.current = authUserId;
    resetForAccountChange();
  }, [authUserId, resetForAccountChange]);
}
