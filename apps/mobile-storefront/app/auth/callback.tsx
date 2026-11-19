import { type Href, router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';
import { StorefrontScreenShell } from '@/components/storefront/StorefrontScreenShell';
import { BRAND } from '@/constants/Colors';
import { useTheme } from '@/hooks/useTheme';
import { createLogger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';

const log = createLogger('AuthCallback');
const callbackDestinations = new Map<string, Href>([
  ['/account', '/(tabs)/account'],
  ['/(tabs)/account', '/(tabs)/account'],
  ['/wallet', '/(tabs)/wallet'],
  ['/(tabs)/wallet', '/(tabs)/wallet'],
]);

function getCallbackDestination(value: string | string[] | undefined): Href {
  if (typeof value !== 'string') return '/';

  try {
    const path = decodeURIComponent(value);
    return callbackDestinations.get(path) ?? '/';
  } catch {
    return '/';
  }
}

/**
 * OAuth Callback Handler (2026 Best Practice — Implicit Flow)
 *
 * With implicit flow, the tokens are returned directly in the URL fragment
 * and handled by signInWithGoogle in the auth store. This route serves as
 * a fallback landing page in case the deep link triggers navigation here.
 *
 * It checks if a session was already established and redirects accordingly.
 */
export default function AuthCallback() {
  const { returnTo } = useLocalSearchParams<{ returnTo?: string | string[] }>();
  const { colors } = useTheme();

  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    async function checkSessionAndRedirect() {
      // Give the auth store a moment to process the session from the URL tokens
      await new Promise<void>((resolve) => {
        timeoutId = setTimeout(resolve, 500);
      });

      if (cancelled) {
        return;
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (cancelled) {
        return;
      }

      if (session) {
        router.replace(getCallbackDestination(returnTo));
      } else {
        log.warn('No session found on callback route, returning to login');
        router.replace('/auth/login');
      }
    }

    checkSessionAndRedirect();

    return () => {
      cancelled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [returnTo]);

  return (
    <StorefrontScreenShell
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <ActivityIndicator size="large" color={BRAND.primary} />
    </StorefrontScreenShell>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
