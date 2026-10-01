import { Alert } from 'react-native';
import {
  type OAuthBrowserModule,
  openOAuthSession,
} from '../lib/auth/open-oauth-session';
import { createLogger } from '../lib/logger';
import { supabase } from '../lib/supabase';
import type { AuthStoreGet, AuthStoreSet } from './auth-store.types';
import { syncAuthenticatedState } from './auth-store-sync';

const log = createLogger('AuthStore');

function normalizeWebBrowserModule(
  module: typeof import('expo-web-browser')
): OAuthBrowserModule {
  if (typeof module.openAuthSessionAsync === 'function') return module;

  const defaultExport = (module as typeof module & { default?: unknown })
    .default;
  if (
    defaultExport &&
    typeof defaultExport === 'object' &&
    typeof (defaultExport as { openAuthSessionAsync?: unknown })
      .openAuthSessionAsync === 'function'
  ) {
    return defaultExport as OAuthBrowserModule;
  }

  throw new Error('expo-web-browser does not expose openAuthSessionAsync');
}

export function createOAuthActions(set: AuthStoreSet, get: AuthStoreGet) {
  return {
    signInWithGoogle: async () => {
      const state = get();
      if (state.isLoading) {
        log.warn('Sign-in already in progress, skipping');
        return { success: false, error: 'Sign-in already in progress' };
      }

      try {
        set({ isLoading: true, error: null });
        const WebBrowser = normalizeWebBrowserModule(
          await import('expo-web-browser')
        );
        const { makeRedirectUri } = await import('expo-auth-session');
        const QueryParams = await import('expo-auth-session/build/QueryParams');
        const redirectUrl = makeRedirectUri();
        const { data, error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: redirectUrl,
            skipBrowserRedirect: true,
            queryParams: { access_type: 'offline', prompt: 'consent' },
          },
        });
        if (error || !data.url) {
          const message = error?.message || 'Failed to get OAuth URL';
          set({ error: message, isLoading: false });
          return { success: false, error: message };
        }

        const result = await openOAuthSession({
          redirectUrl,
          url: data.url,
          webBrowser: WebBrowser,
        });
        if (result.type !== 'success' || !result.url) {
          set({ isLoading: false });
          return result.type === 'cancel' || result.type === 'dismiss'
            ? { success: false, error: 'Sign-in cancelled' }
            : { success: false, error: `Login failed: ${result.type}` };
        }

        const { params, errorCode } = QueryParams.getQueryParams(result.url);
        if (errorCode) {
          set({ isLoading: false });
          return { success: false, error: errorCode };
        }
        const code = params.code;
        if (!code) {
          set({ isLoading: false });
          return {
            success: false,
            error: 'No authorization code received from Google',
          };
        }

        const { data: sessionData, error: sessionError } =
          await supabase.auth.exchangeCodeForSession(code);
        if (sessionError) {
          set({ isLoading: false });
          Alert.alert('Sign-In Error', sessionError.message);
          return { success: false, error: sessionError.message };
        }

        const establishedSession = sessionData.session ?? null;
        const authenticatedUser =
          establishedSession?.user ?? sessionData.user ?? null;
        if (!authenticatedUser) {
          set({ isLoading: false });
          return {
            success: false,
            error: 'Unable to complete sign-in. Please try again.',
          };
        }

        await syncAuthenticatedState({
          merchantId: get().merchantId,
          session: establishedSession,
          set,
          user: authenticatedUser,
        });
        set({ isLoading: false });
        return { success: true };
      } catch (error) {
        log.error('Google sign-in error:', error);
        set({ isLoading: false });
        return {
          success: false,
          error:
            error instanceof Error ? error.message : 'Google sign-in failed',
        };
      }
    },
    signInWithApple: async () => {
      try {
        set({ isLoading: true, error: null });
        const AppleAuthentication = await import('expo-apple-authentication');
        const isAvailable = await AppleAuthentication.isAvailableAsync();
        if (!isAvailable) {
          throw new Error(
            'Apple Authentication is not available on this device'
          );
        }

        const credential = await AppleAuthentication.signInAsync({
          requestedScopes: [
            AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
            AppleAuthentication.AppleAuthenticationScope.EMAIL,
          ],
        });
        if (!credential.identityToken) {
          throw new Error('Apple Sign-In failed: No identity token received');
        }

        const fullName = credential.fullName
          ? `${credential.fullName.givenName || ''} ${credential.fullName.familyName || ''}`.trim()
          : null;
        const { data, error } = await supabase.auth.signInWithIdToken({
          provider: 'apple',
          token: credential.identityToken,
        });
        if (error) {
          set({ error: error.message, isLoading: false });
          return { success: false, error: error.message };
        }

        const authenticatedSession = data.session ?? null;
        const authenticatedUser =
          authenticatedSession?.user ?? data.user ?? null;
        if (!authenticatedUser) {
          set({ isLoading: false });
          return {
            success: false,
            error: 'Unable to complete sign-in. Please try again.',
          };
        }

        await syncAuthenticatedState({
          merchantId: get().merchantId,
          session: authenticatedSession,
          set,
          user: authenticatedUser,
        });
        if (fullName && data.user && !data.user.user_metadata?.full_name) {
          await supabase.auth.updateUser({ data: { full_name: fullName } });
          const { merchantId } = get();
          if (merchantId && data.user.email) {
            const { error: rpcError } = await supabase.rpc(
              'upsert_customer_on_auth',
              {
                p_merchant_id: merchantId,
                p_user_id: data.user.id,
                p_email: data.user.email,
                p_full_name: fullName,
                p_phone: null,
              }
            );
            if (rpcError) {
              log.warn('Failed to upsert customer after Apple auth:', {
                merchantId,
                userId: data.user.id,
                error: rpcError.message,
              });
            }
          }
        }

        set({ isLoading: false });
        return { success: true };
      } catch (error) {
        if (
          error instanceof Error &&
          'code' in error &&
          (error as Error & { code: string }).code === 'ERR_REQUEST_CANCELED'
        ) {
          set({ isLoading: false });
          return { success: false, error: 'Sign in was cancelled' };
        }
        const message =
          error instanceof Error
            ? error.message
            : 'Failed to sign in with Apple';
        log.error('Apple sign-in error:', error);
        set({ error: message, isLoading: false });
        return { success: false, error: message };
      }
    },
  };
}
