import {
  type DeleteAccountResult,
  getDeleteAccountErrorMessage,
} from '../lib/account-deletion';
import { createLogger } from '../lib/logger';
import { getStoredPushToken } from '../lib/push-token-storage';
import { clearQueryCachePreservingObservers } from '../lib/query-cache-observer-safety';
import { queryClient } from '../lib/query-client';
import { supabase } from '../lib/supabase';
import type { AuthStoreGet, AuthStoreSet } from './auth-store.types';
import { createDateOfBirthAction } from './auth-store-account-date-of-birth';
import { createProfileActions } from './auth-store-account-profile';
import { clearLocalAndDeactivatePushToken } from './auth-store-push';
import { useCartStore } from './cart-store';
import { clearDeviceCartForAccountTeardown } from './clear-device-cart';
import { useComparisonStore } from './comparison-store';
import { useQuizStore } from './quiz-store';
import { useSavedStore } from './saved-store';
import { retireSharedCartWriter } from './shared-cart-writer';

const log = createLogger('AuthStore');

async function clearUserStores() {
  try {
    await clearDeviceCartForAccountTeardown();
  } catch {
    log.error('Failed to retire cart device during account teardown');
    // Blank the displayed items even when retirement failed: the
    // merchant reference stays for a retirement retry, but the
    // previous account's items must not greet the next identity.
    if (typeof useCartStore.setState === 'function') {
      useCartStore.setState({
        items: [],
        lineSequence: 0,
        cartWideNegotiationActive: false,
      });
    }
  }
  useSavedStore.getState().clearSaved();
  useComparisonStore.getState().clearComparison();
  useQuizStore.getState().reset();
}

export function createAccountActions(set: AuthStoreSet, get: AuthStoreGet) {
  return {
    signOut: async () => {
      try {
        set({ isLoading: true });
        // Fence old cart callbacks before any Auth/network await.
        const retireCart = retireSharedCartWriter();
        void retireCart.catch(() => undefined);
        const storedToken = await getStoredPushToken();
        await clearLocalAndDeactivatePushToken(storedToken);
        const { error: signOutError } = await supabase.auth.signOut();
        if (signOutError) {
          await supabase.auth
            .signOut({ scope: 'local' })
            .catch((localError) =>
              log.warn('Local signOut fallback failed:', localError)
            );
        }
        if (signOutError || !get()._authSubscription) {
          clearQueryCachePreservingObservers(queryClient);
        }
        await clearUserStores();
        set({
          user: null,
          session: null,
          customer: null,
          isLoading: false,
          isInitialized: true,
          _initializationInProgress: false,
        });
      } catch (error) {
        log.error('Sign out error:', error);
        // The cart generation has already been retired. Finish local
        // teardown even if the provider sign-out request threw.
        try {
          await supabase.auth.signOut({ scope: 'local' });
        } catch (localError) {
          log.warn('Local signOut fallback failed:', localError);
        }
        try {
          await clearUserStores();
        } catch {
          log.error('Local store cleanup failed during sign out');
        } finally {
          try {
            clearQueryCachePreservingObservers(queryClient);
          } finally {
            set({
              user: null,
              session: null,
              customer: null,
              isLoading: false,
              isInitialized: true,
              _initializationInProgress: false,
            });
          }
        }
      }
    },
    deleteAccount: async (): Promise<DeleteAccountResult> => {
      try {
        const { user } = get();
        const usedApple =
          user?.app_metadata?.providers?.includes('apple') ?? false;
        const { error } = await supabase.rpc(
          'delete_current_storefront_account'
        );
        if (error)
          return { success: false, error: getDeleteAccountErrorMessage(error) };

        const retireCart = retireSharedCartWriter();
        void retireCart.catch(() => undefined);
        const storedToken = await getStoredPushToken();
        await clearLocalAndDeactivatePushToken(storedToken);
        let localSignOutError: unknown = null;
        try {
          ({ error: localSignOutError } = await supabase.auth.signOut({
            scope: 'local',
          }));
        } catch (error) {
          localSignOutError = error;
          log.warn('Local signOut failed after account deletion:', error);
        }
        if (localSignOutError || !get()._authSubscription) {
          clearQueryCachePreservingObservers(queryClient);
        }
        await clearUserStores();
        set({
          user: null,
          session: null,
          customer: null,
          isLoading: false,
          isInitialized: true,
          _initializationInProgress: false,
        });
        return { success: true, usedApple };
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Something went wrong. Please try again.';
        return { success: false, error: message };
      }
    },
    refreshSession: async () => {
      try {
        const {
          data: { session },
          error,
        } = await supabase.auth.refreshSession();
        if (error) {
          log.error('Session refresh error:', error);
          return;
        }
        if (session) set({ session });
      } catch (error) {
        log.error('Session refresh error:', error);
      }
    },
    ...createProfileActions(set, get),
    ...createDateOfBirthAction(set, get),
  };
}
