import { withReceiptClaimedSearchParam } from '@baci/shared/lib';
import { sanitizeMaskedCustomerLoginEmailHint } from '@baci/shared/schemas';
import { useQueryClient } from '@tanstack/react-query';
import { type Href, Redirect, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  type ClaimStatus,
  ReceiptClaimStatusCard,
} from '@/components/receipts/receipt-claim-status-card';
import { StorefrontScreenShell } from '@/components/storefront/StorefrontScreenShell';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { EXPO_PUBLIC_API_URL } from '@/env';
import { useRequireAuth } from '@/hooks/use-auth-guard';
import { getSession } from '@/lib/supabase';

function readParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function readEmailHint(value: string | string[] | undefined) {
  // The login redirect carries the masked hint (never a full address).
  const raw = Array.isArray(value) ? value[0] : value;
  return sanitizeMaskedCustomerLoginEmailHint(raw) || null;
}

function appendEmailHintToLoginRedirect(href: string, email: string | null) {
  if (!email) {
    return href;
  }

  const separator = href.includes('?') ? '&' : '?';
  return `${href}${separator}email=${encodeURIComponent(email)}`;
}

function buildClaimApiUrl(token: string) {
  const baseUrl = EXPO_PUBLIC_API_URL.replace(/\/+$/, '');
  return `${baseUrl}/api/storefront/receipts/claims/${encodeURIComponent(token)}`;
}

function buildClaimLoginEmailApiUrl(token: string) {
  return `${buildClaimApiUrl(token)}/login-email?source=app`;
}

async function readErrorMessage(response: Response) {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === 'string'
      ? body.error
      : 'We could not move this receipt into your app.';
  } catch {
    return 'We could not move this receipt into your app.';
  }
}

async function readRedirectPath(response: Response) {
  try {
    const body = (await response.json()) as { redirectPath?: unknown };
    return typeof body.redirectPath === 'string' &&
      body.redirectPath.startsWith('/')
      ? body.redirectPath
      : '/receipts';
  } catch {
    return '/receipts';
  }
}

async function readLoginEmailHint(response: Response) {
  try {
    const body = (await response.json()) as { emailHint?: unknown };
    // The login-email route returns only the masked hint.
    return sanitizeMaskedCustomerLoginEmailHint(
      typeof body.emailHint === 'string' ? body.emailHint : null
    );
  } catch {
    return '';
  }
}

export default function ReceiptClaimScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{
    email?: string | string[];
    token?: string | string[];
  }>();
  const token = readParam(params.token);
  const routeEmailHint = readEmailHint(params.email);
  const { isLoading: isAuthLoading, redirectTo } = useRequireAuth();
  const [attempt, setAttempt] = useState(0);
  const [loginEmailHint, setLoginEmailHint] = useState<string | null>(
    routeEmailHint
  );
  const [loginEmailHintLoaded, setLoginEmailHintLoaded] = useState(
    Boolean(routeEmailHint)
  );
  const [message, setMessage] = useState('Checking your sign-in...');
  const [status, setStatus] = useState<ClaimStatus>('loading');

  useEffect(() => {
    const claimToken = token;
    if (!redirectTo || !claimToken || routeEmailHint || loginEmailHintLoaded) {
      return;
    }

    let isActive = true;

    async function loadLoginEmailHint(claimTokenValue: string) {
      try {
        const response = await fetch(
          buildClaimLoginEmailApiUrl(claimTokenValue),
          {
            headers: { Accept: 'application/json' },
            method: 'GET',
          }
        );
        if (!isActive) return;
        setLoginEmailHint(
          response.ok ? await readLoginEmailHint(response) : ''
        );
      } catch {
        if (!isActive) return;
        setLoginEmailHint('');
      } finally {
        if (isActive) {
          setLoginEmailHintLoaded(true);
        }
      }
    }

    void loadLoginEmailHint(claimToken);

    return () => {
      isActive = false;
    };
  }, [loginEmailHintLoaded, redirectTo, routeEmailHint, token]);

  useEffect(() => {
    let isActive = true;

    async function claimReceipt() {
      if (isAuthLoading || redirectTo) {
        return;
      }

      if (!token) {
        setStatus('error');
        setMessage('This receipt link is missing its claim token.');
        return;
      }

      setStatus('claiming');
      setMessage(attempt > 0 ? 'Trying again...' : 'Securing this receipt...');

      try {
        const session = await getSession();
        if (!session?.access_token) {
          if (!isActive) return;
          setStatus('error');
          setMessage('Please sign in again to claim this receipt.');
          return;
        }

        const response = await fetch(buildClaimApiUrl(token), {
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          method: 'POST',
        });

        if (!isActive) return;

        if (!response.ok) {
          setStatus('error');
          setMessage(await readErrorMessage(response));
          return;
        }

        const redirectPath = await readRedirectPath(response);

        try {
          await queryClient.invalidateQueries({ queryKey: ['receipts'] });
        } catch {
          // The claim succeeded; navigation should not be blocked by cache refresh.
        }

        if (!isActive) return;
        // Validated server path (starts with '/'); typed routes need an Href.
        router.replace(withReceiptClaimedSearchParam(redirectPath) as Href);
      } catch {
        if (!isActive) return;
        setStatus('error');
        setMessage('A network error occurred. Please check your connection.');
      }
    }

    void claimReceipt();

    return () => {
      isActive = false;
    };
  }, [attempt, isAuthLoading, queryClient, redirectTo, token]);

  if (redirectTo) {
    if (token && !loginEmailHintLoaded) {
      return (
        <StorefrontScreenShell
          edges={['bottom']}
          style={[styles.screen, { backgroundColor: colors.background }]}
        >
          <View style={styles.content}>
            <ReceiptClaimStatusCard
              colors={colors}
              message="Preparing sign-in..."
              status="loading"
            />
          </View>
        </StorefrontScreenShell>
      );
    }

    return (
      <Redirect
        href={
          appendEmailHintToLoginRedirect(
            String(redirectTo),
            loginEmailHint
          ) as Href
        }
      />
    );
  }

  return (
    <StorefrontScreenShell
      edges={['bottom']}
      style={[styles.screen, { backgroundColor: colors.background }]}
    >
      <View style={styles.content}>
        <ReceiptClaimStatusCard
          colors={colors}
          message={message}
          onRetry={() => setAttempt((value) => value + 1)}
          status={status}
        />
      </View>
    </StorefrontScreenShell>
  );
}

const styles = StyleSheet.create({
  content: {
    alignItems: 'stretch',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  screen: {
    flex: 1,
  },
});
