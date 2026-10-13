import type { Session } from '@supabase/supabase-js';
import { createLogger } from '../lib/logger';
import { getStoredPushToken } from '../lib/push-token-storage';
import { clearQueryCachePreservingObservers } from '../lib/query-cache-observer-safety';
import { queryClient } from '../lib/query-client';
import { supabase } from '../lib/supabase';
import { MerchantRowSchema } from '../lib/validation';
import {
  initTimeout,
  isInitTimeoutError,
  shouldInvalidateSessionOnGetUserError,
} from './auth-helpers';
import type { AuthStoreGet, AuthStoreSet } from './auth-store.types';
import { clearLocalAndDeactivatePushToken } from './auth-store-push';
import { syncAuthenticatedState } from './auth-store-sync';
import { useCartStore } from './cart-store';
import { useComparisonStore } from './comparison-store';
import { useQuizStore } from './quiz-store';
import { useSavedStore } from './saved-store';

const log = createLogger('AuthStore');

function deferAuthStateChange(work: () => Promise<void>) {
  setTimeout(() => {
    void work().catch((authListenerError: unknown) => {
      log.error('Error in auth state change handler:', authListenerError);
    });
  }, 0);
}

export function createInitializeAction({
  get,
  merchantSlug,
  set,
}: {
  get: AuthStoreGet;
  merchantSlug: string;
  set: AuthStoreSet;
}) {
  return async () => {
    const state = get();
    if (state._initializationInProgress || state.isInitialized) {
      log.debug('Initialize already in progress or completed, skipping');
      return;
    }

    const initGen = Date.now();
    set({ _initializationInProgress: true, _initGen: initGen });

    try {
      set({ isLoading: true, error: null });
      const { data: merchant, error: merchantError } = await initTimeout(
        supabase
          .from('merchants')
          .select('id')
          .eq('slug', merchantSlug)
          .single(),
        'merchant lookup'
      );
      if (get()._initGen !== initGen) return;

      const merchantValidation = MerchantRowSchema.safeParse(merchant);
      let resolvedMerchantId: string | null = null;
      if (merchantError || !merchantValidation.success) {
        set({ merchantId: null });
      } else {
        resolvedMerchantId = merchantValidation.data.id;
        set({ merchantId: resolvedMerchantId });
      }

      let initialSession: Session | null = null;
      let sessionError: unknown = null;
      try {
        const sessionResult = await initTimeout(
          supabase.auth.getSession(),
          'getSession'
        );
        initialSession = sessionResult.data.session;
        sessionError = sessionResult.error;
      } catch (sessionReadError) {
        if (!isInitTimeoutError(sessionReadError, 'getSession')) {
          throw sessionReadError;
        }

        log.warn(
          'getSession timed out during startup; continuing as guest until auth state changes.',
          sessionReadError
        );
      }
      if (get()._initGen !== initGen) return;
      if (sessionError) throw sessionError;

      let session = initialSession;
      if (session) {
        const { error: userError } = await initTimeout(
          supabase.auth.getUser(),
          'getUser'
        );
        if (get()._initGen !== initGen) return;
        if (userError && shouldInvalidateSessionOnGetUserError(userError)) {
          const {
            data: { session: refreshedSession },
            error: refreshError,
          } = await initTimeout(
            supabase.auth.refreshSession(),
            'refreshSession'
          );
          if (get()._initGen !== initGen) return;
          if (refreshError || !refreshedSession) {
            await supabase.auth
              .signOut({ scope: 'local' })
              .catch(() => undefined);
            session = null;
          } else {
            session = refreshedSession;
          }
        }
      }

      if (session?.user) {
        set({
          user: session.user,
          session,
          customer: null,
          isLoading: false,
          isInitialized: true,
        });
        if (resolvedMerchantId) {
          void syncAuthenticatedState({
            getInitGen: () => get()._initGen,
            initGen,
            merchantId: resolvedMerchantId,
            session,
            set,
            skipImmediateState: true,
            user: session.user,
          });
        }
      } else {
        set({
          user: null,
          session: null,
          customer: null,
          isLoading: false,
          isInitialized: true,
        });
      }

      const { data: authListener } = supabase.auth.onAuthStateChange(
        (event, session) => {
          const { merchantId, user: previousUser } = get();
          deferAuthStateChange(async () => {
            if (event === 'SIGNED_IN' && session?.user) {
              // Only wipe quiz state on an actual account SWITCH. SIGNED_IN also
              // fires on same-user session re-establishment / token refresh —
              // resetting then would kick a shopper out of an in-progress quiz.
              if (previousUser?.id !== session.user.id) {
                useQuizStore.getState().reset();
              }
              await syncAuthenticatedState({
                merchantId,
                session,
                set,
                user: session.user,
              });
              const guestCartItems = useCartStore.getState().items;
              if (guestCartItems.length > 0) {
                log.info(
                  `Cart sync: ${guestCartItems.length} items preserved after login`
                );
              }
            } else if (event === 'SIGNED_OUT') {
              const storedToken = await getStoredPushToken();
              await clearLocalAndDeactivatePushToken(storedToken);
              await useCartStore.getState().clearCart();
              useSavedStore.getState().clearSaved();
              useComparisonStore.getState().clearComparison();
              useQuizStore.getState().reset();
              set({
                user: null,
                session: null,
                customer: null,
                isLoading: false,
                isInitialized: true,
                _initializationInProgress: false,
              });
              clearQueryCachePreservingObservers(queryClient);
            } else if (event === 'TOKEN_REFRESHED' && session) {
              set({ session });
            }
          });
        }
      );

      if (get()._initGen !== initGen) {
        authListener.subscription.unsubscribe();
        return;
      }
      set({
        _authSubscription: authListener,
        _initializationInProgress: false,
      });
    } catch (error) {
      if (get()._initGen !== initGen) return;
      log.error('Auth initialization error:', error);
      set({
        error: error instanceof Error ? error.message : 'Failed to initialize',
        isLoading: false,
        isInitialized: true,
        _initializationInProgress: false,
      });
    }
  };
}

export function createCleanupAction(set: AuthStoreSet, get: AuthStoreGet) {
  return () => {
    set({ _initGen: Date.now(), _initializationInProgress: false });
    const state = get();
    if (state._authSubscription?.subscription) {
      log.debug('Cleaning up auth subscription');
      state._authSubscription.subscription.unsubscribe();
      set({ _authSubscription: null });
    }
  };
}
