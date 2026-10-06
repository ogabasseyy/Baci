import type { User } from '@supabase/supabase-js';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { activateDueSavingsReminderSafely } from '@/services/activate-savings-reminder-safely';

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
 */
export function useSavingsReminderActivation({
  storeUser,
  isInitialized,
  isStorageReady,
  isTrackingAuthorizationSettled,
}: {
  storeUser: Pick<User, 'id'> | null;
  isInitialized: boolean;
  isStorageReady: boolean;
  isTrackingAuthorizationSettled: boolean;
}) {
  // Signed-out boots must not activate: reminder storage is device-global,
  // and without a user the service falls back to local scheduling, which
  // would surface the previous account's goal titles and amounts.
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
