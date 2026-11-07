'use client';

interface OAuthRedirectResponse {
  url?: string;
  error?: string;
}

async function signInWithOAuth(
  merchantSlug: string,
  endpointPath: string,
  allowedHosts: string[],
  providerLabel: string,
  returnTo?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Cart authority is NOT retired here: if the endpoint errors or
    // the shopper cancels at the provider, the existing session must
    // keep its cart. Retirement happens when the callback commits a
    // different identity (loadCustomerSession /
    // commitCustomerAuthSession retire the previous account then,
    // with auth rollback when revocation fails).
    // Use the current browser origin to support custom domains (e.g., ogabassey.com)
    // This automatically handles: localhost, subdomains (*.usebaci.com), and custom domains
    // We redirect to /account/callback which exchanges the OAuth code for a session
    let redirectPath = '/account/callback';
    if (typeof window !== 'undefined') {
      const pathname = window.location.pathname;
      // If we are using path-based routing (e.g. /ogabassey/...), preserve the slug
      if (pathname.startsWith(`/${merchantSlug}`)) {
        redirectPath = `/${merchantSlug}/account/callback`;
      }
    }

    if (returnTo) redirectPath += `?next=${encodeURIComponent(returnTo)}`;

    const redirectUrl =
      typeof window !== 'undefined'
        ? `${window.location.origin}${redirectPath}`
        : '/account/callback';

    const response = await fetch(endpointPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ merchantSlug, redirectUrl }),
    });

    const data: OAuthRedirectResponse = await response.json();

    if (!response.ok) {
      return {
        success: false,
        error: data.error || `Failed to initiate ${providerLabel} sign-in`,
      };
    }

    // Check for data.url before redirecting
    if (!data.url) {
      return {
        success: false,
        error: 'Missing OAuth redirect URL',
      };
    }

    // Validate that the URL is from an allowed OAuth provider
    try {
      const url = new URL(data.url);
      const isValidDomain = allowedHosts.some((h) => {
        if (h.startsWith('.')) {
          // Wildcard domain like .google.com or .supabase.co
          return url.hostname.endsWith(h);
        }
        return url.hostname === h;
      });

      if (!isValidDomain) {
        return {
          success: false,
          error: 'Invalid OAuth provider URL',
        };
      }
    } catch {
      return {
        success: false,
        error: 'Invalid OAuth URL format',
      };
    }

    window.location.href = data.url;
    return { success: true };
  } catch (error) {
    console.error(providerLabel, 'sign-in error:', error);
    return { success: false, error: 'Network error. Please try again.' };
  }
}

// Sign in with Google OAuth
export const signInWithGoogle = (
  merchantSlug: string,
  returnTo?: string
): Promise<{
  success: boolean;
  error?: string;
}> => {
  return signInWithOAuth(
    merchantSlug,
    '/api/storefront/auth/google',
    [
      'accounts.google.com',
      'www.google.com',
      '.google.com', // Wildcard for *.google.com
      'supabase.co',
      '.supabase.co', // Wildcard for *.supabase.co
      ...(process.env.NODE_ENV !== 'production'
        ? ['127.0.0.1', 'localhost']
        : []),
    ],
    'Google',
    returnTo
  );
};

// Sign in with Apple OAuth
export const signInWithApple = (
  merchantSlug: string,
  returnTo?: string
): Promise<{
  success: boolean;
  error?: string;
}> => {
  return signInWithOAuth(
    merchantSlug,
    '/api/storefront/auth/apple',
    [
      'appleid.apple.com',
      '.apple.com', // Wildcard for *.apple.com
      'supabase.co',
      '.supabase.co', // Wildcard for *.supabase.co
      ...(process.env.NODE_ENV !== 'production'
        ? ['127.0.0.1', 'localhost']
        : []),
    ],
    'Apple',
    returnTo
  );
};
