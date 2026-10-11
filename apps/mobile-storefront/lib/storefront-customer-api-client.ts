import { EXPO_PUBLIC_API_URL } from '@/env';
import { CONFIG } from '@/lib/config';
import { DEFAULT_TIMEOUT, fetchWithTimeout } from '@/lib/fetch-with-timeout';
import { supabase } from '@/lib/supabase';
import { StorefrontCsrfTokenSchema } from '@/schemas/storefront-csrf-token';

export type MerchantIdentifiersInput = {
  merchantId?: string | null;
  merchantSlug?: string | null;
};

type FetchStorefrontCustomerApiInput = {
  path: string;
  body?: Record<string, unknown>;
  includeCsrf?: boolean;
  method?: 'GET' | 'POST' | 'PATCH';
  query?: MerchantIdentifiersInput & { goalId?: string };
  signal?: AbortSignal;
  /**
   * Binds the request to the user the caller acted for. The check runs
   * inside the same session read that mints the Bearer [REDACTED], so an
   * account switch between the caller's own check and this send cannot
   * silently re-authenticate a mutation (or a cached funding snapshot)
   * as the new user: the token in hand provably belongs to the expected
   * user, or the call throws before any bytes leave the device.
   */
  expectedUserId?: string;
};

const ACCESS_TOKEN_CACHE_SAFETY_WINDOW_MS = 30_000;

function getResponseErrorMessage(data: Record<string, unknown>) {
  return typeof data.error === 'string'
    ? data.error
    : 'Request failed. Please try again.';
}

function getResponseError(data: Record<string, unknown>) {
  const error = new Error(getResponseErrorMessage(data)) as Error & {
    code?: string;
  };
  if (typeof data.code === 'string') {
    error.code = data.code;
  }
  return error;
}

function getOptionalString(value: string | null | undefined) {
  const trimmedValue = value?.trim();
  return trimmedValue ? trimmedValue : undefined;
}

function getMerchantSlug(value?: string | null) {
  return getOptionalString(value) ?? getOptionalString(CONFIG.MERCHANT_SLUG);
}

async function parseJsonResponse(response: Response) {
  let data: Record<string, unknown>;
  try {
    data = (await response.json()) as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `Invalid server response (${response.status} ${response.statusText || 'Unknown status'}): ${
        error instanceof Error ? error.message : 'Unable to parse response'
      }`
    );
  }

  if (!response.ok) {
    throw getResponseError(data);
  }

  return data;
}

function buildMerchantIdentifiers({
  merchantId,
  merchantSlug,
}: MerchantIdentifiersInput) {
  return {
    merchantId: getOptionalString(merchantId),
    merchantSlug: getMerchantSlug(merchantSlug),
  };
}

function buildQueryString(
  input: MerchantIdentifiersInput & { goalId?: string }
) {
  const searchParams = new URLSearchParams();
  const identifiers = buildMerchantIdentifiers(input);

  if (identifiers.merchantId) {
    searchParams.set('merchantId', identifiers.merchantId);
  }
  if (identifiers.merchantSlug) {
    searchParams.set('merchantSlug', identifiers.merchantSlug);
  }
  const goalId = getOptionalString(input.goalId);
  if (goalId) searchParams.set('goalId', goalId);

  return searchParams.toString();
}

export function createStorefrontCustomerApiClient() {
  let cachedAccessToken: string | null = null;
  let cachedAccessTokenExpiresAt = 0;
  let cachedAccessTokenUserId: string | null = null;

  const clearCachedAccessToken = () => {
    cachedAccessToken = null;
    cachedAccessTokenExpiresAt = 0;
    cachedAccessTokenUserId = null;
  };

  const getAccessToken = async (expectedUserId?: string) => {
    if (cachedAccessToken && cachedAccessTokenExpiresAt > Date.now()) {
      // The cache is a performance shortcut, never an identity
      // decision: a pinned token from a previous account must not
      // satisfy a new account's request (or vice versa). Drop it and
      // re-read below instead of throwing: the session may simply
      // have rotated since the cache filled.
      if (
        expectedUserId === undefined ||
        cachedAccessTokenUserId === expectedUserId
      )
        return cachedAccessToken;
      clearCachedAccessToken();
    } else {
      clearCachedAccessToken();
    }

    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError || !session?.access_token) {
      clearCachedAccessToken();
      throw new Error('Authentication required. Please sign in again.');
    }
    // Atomic with the token handoff: the token returned below belongs
    // to this user, so a switch landing after this read cannot change
    // which identity the request authenticates as.
    if (expectedUserId !== undefined && session.user?.id !== expectedUserId) {
      clearCachedAccessToken();
      throw new Error('The signed-in account changed. Please try again.');
    }

    const expiresAtMs =
      typeof session.expires_at === 'number'
        ? session.expires_at * 1000 - ACCESS_TOKEN_CACHE_SAFETY_WINDOW_MS
        : 0;
    if (expiresAtMs > Date.now()) {
      cachedAccessToken = session.access_token;
      cachedAccessTokenExpiresAt = expiresAtMs;
      cachedAccessTokenUserId = session.user?.id ?? null;
    }

    return session.access_token;
  };

  const fetchJson = async ({
    body,
    includeCsrf = false,
    method = 'GET',
    path,
    query,
    signal,
    expectedUserId,
  }: FetchStorefrontCustomerApiInput) => {
    const accessToken = await getAccessToken(expectedUserId);
    let csrfToken: string | undefined;
    if (includeCsrf) {
      const csrfResponse = await fetchWithTimeout(
        `${EXPO_PUBLIC_API_URL}/api/csrf`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          method: 'GET',
          signal,
          timeout: DEFAULT_TIMEOUT,
        }
      );
      csrfToken = StorefrontCsrfTokenSchema.parse(
        await parseJsonResponse(csrfResponse)
      ).token;
    }
    const queryString = query ? buildQueryString(query) : '';
    const url = `${EXPO_PUBLIC_API_URL}${path}${queryString ? `?${queryString}` : ''}`;
    const response = await fetchWithTimeout(url, {
      body: body ? JSON.stringify(body) : undefined,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
      },
      method,
      signal,
      timeout: DEFAULT_TIMEOUT,
    });

    return parseJsonResponse(response);
  };

  return {
    buildMerchantIdentifiers,
    fetchJson,
  };
}
