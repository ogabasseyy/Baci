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

  const clearCachedAccessToken = () => {
    cachedAccessToken = null;
    cachedAccessTokenExpiresAt = 0;
  };

  const getAccessToken = async () => {
    if (cachedAccessToken && cachedAccessTokenExpiresAt > Date.now()) {
      return cachedAccessToken;
    }
    clearCachedAccessToken();

    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError || !session?.access_token) {
      clearCachedAccessToken();
      throw new Error('Authentication required. Please sign in again.');
    }

    const expiresAtMs =
      typeof session.expires_at === 'number'
        ? session.expires_at * 1000 - ACCESS_TOKEN_CACHE_SAFETY_WINDOW_MS
        : 0;
    if (expiresAtMs > Date.now()) {
      cachedAccessToken = session.access_token;
      cachedAccessTokenExpiresAt = expiresAtMs;
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
  }: FetchStorefrontCustomerApiInput) => {
    const accessToken = await getAccessToken();
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
