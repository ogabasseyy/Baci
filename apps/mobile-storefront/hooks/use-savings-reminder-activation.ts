import type { User } from '@supabase/supabase-js';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { activateDueSavingsReminderSafely } from '@/services/activate-savings-reminder-safely';
import {
  buildReminderScope,
  cancelScopeSavingsReminders,
} from '@/services/savings-reminder-notifications';

/**
 * Boot + foreground activation for due savings reminders.
 *
 * A future-dated manual plan stores only a pending request — no OS
 * notification exists until its start date passes. The boot effect covers
 * cold starts; the foreground listener covers an app that stays installed
 * and running across the start date, converting the request into the
 * recurring series the next time the user foregrounds. Gated on the same
 * boot-readiness signals plus a signed-in user, via ref (read fresh on
 * every event) so logged-out and pre-init foregrounds skip the
 * storage/capability work without depending on the service's own guard.
 *
 * Mounted at the root so it also observes every authentication change:
 * reminder records are scoped per user+merchant, and the previous scope's
 * live OS notifications are cancelled (and re-armed) on switch or sign-out
 * so one account's reminders never fire under another.
 */
export function useSavingsReminderActivation({
  storeUser,
  storeMerchantId,
  isInitialized,
  isStorageReady,
  isTrackingAuthorizationSettled,
}: {
  storeUser: Pick<User, 'id'> | null;
  storeMerchantId: string | null;
  isInitialized: boolean;
  isStorageReady: boolean;
  isTrackingAuthorizationSettled: boolean;
}) {
  // Signed-out boots must not activate: without a user there is no storage
  // scope, and the service would otherwise fall back to local scheduling.
  const storeUserId = storeUser?.id ?? null;
  useEffect(() => {
    if (
      storeUserId &&
      isInitialized &&
      isStorageReady &&
      isTrackingAuthorizationSettled
    ) {
      activateDueSavingsReminderSafely();
    }
  }, [
    storeUserId,
    isInitialized,
    isStorageReady,
    isTrackingAuthorizationSettled,
  ]);

  const scope = buildReminderScope(storeUserId, storeMerchantId);
  const scopeKey = scope ? `${scope.userId}:${scope.merchantId}` : null;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const prevScopeKeyRef = useRef<string | null>(null);
  const prevScopeRef = useRef<typeof scope>(null);
  useEffect(() => {
    const prevScope = prevScopeRef.current;
    const prevKey = prevScopeKeyRef.current;
    prevScopeRef.current = scopeRef.current;
    prevScopeKeyRef.current = scopeKey;
    // Skip the initial mount (no previous scope observed yet); afterwards,
    // any account or merchant change retires the previous scope's live OS
    // notifications. Best effort — must never break the auth transition.
    if (prevKey !== null && prevKey !== scopeKey && prevScope) {
      void cancelScopeSavingsReminders(prevScope).catch(() => undefined);
    }
  }, [scopeKey]);

  const bootReadyRef = useRef(false);
  bootReadyRef.current =
    Boolean(storeUser) &&
    isInitialized &&
    isStorageReady &&
    isTrackingAuthorizationSettled;
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && bootReadyRef.current) {
        activateDueSavingsReminderSafely();
      }
    });
    return () => subscription.remove();
  }, []);
}
