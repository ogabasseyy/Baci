import type { SupabaseClient } from '@supabase/supabase-js';
import { JumiaApiError } from '@/lib/jumia/helpers';
import {
  JumiaSelfAuthorizationTokenResponseSchema,
  JumiaTokenResponseSchema,
} from '@/schemas/jumia';
import {
  acquireJumiaAuthorizationRefreshLease,
  type CarriedJumiaAuthorizationCredentials,
  releaseJumiaAuthorizationRefreshLease,
} from './jumia-authorization-refresh-lease';
import { persistJumiaAuthorizationRotation } from './jumia-client-token-rotation';

const REQUEST_TIMEOUT_MS = 30_000;
const MISSING_REFRESH_TOKEN_SYNC_ERROR =
  'Reconnect Jumia to resume syncing. Jumia did not return a refresh token for this OAuth connection.';

const refreshInFlight = new Map<
  string,
  Promise<Partial<JumiaClientTokenPersistenceState>>
>();

function getRefreshLockKey(state: JumiaClientTokenPersistenceState): string {
  return state.authorizationId ?? state.integrationId;
}

export type JumiaClientTokenPersistenceState = {
  integrationId: string;
  merchantId: string;
  accessToken: string | null;
  refreshToken: string;
  clientId: string;
  authorizationId?: string;
  authorizationRotationVersion?: number;
  tokenExpiresAt: Date | null;
  refreshTokenExpiresAt?: Date | null;
  supabase: SupabaseClient | null;
  apiBase: string;
};

type FetchWithThrottle = (url: string, init: RequestInit) => Promise<Response>;

function getScopedSupabaseForPersistence(
  state: JumiaClientTokenPersistenceState
): SupabaseClient {
  if (state.supabase) {
    return state.supabase;
  }

  throw new JumiaApiError(
    500,
    'Scoped Supabase client is required to persist Jumia token state'
  );
}

function toRefreshState(state: JumiaClientTokenPersistenceState) {
  if (!state.authorizationId) {
    throw new JumiaApiError(
      500,
      'Shared Jumia authorization id is required to refresh credentials'
    );
  }

  return {
    integrationId: state.integrationId,
    merchantId: state.merchantId,
    authorizationId: state.authorizationId,
    authorizationRotationVersion: state.authorizationRotationVersion,
    tokenExpiresAt: state.tokenExpiresAt,
    refreshTokenExpiresAt: state.refreshTokenExpiresAt,
  };
}

export function refreshJumiaClientAccessToken(
  state: JumiaClientTokenPersistenceState,
  fetchWithThrottle: FetchWithThrottle
): Promise<Partial<JumiaClientTokenPersistenceState>> {
  const lockKey = getRefreshLockKey(state);
  const inFlight = refreshInFlight.get(lockKey);
  if (inFlight) {
    return inFlight;
  }

  const refreshPromise = refreshJumiaClientAccessTokenOnce(
    state,
    fetchWithThrottle
  ).finally(() => {
    refreshInFlight.delete(lockKey);
  });
  refreshInFlight.set(lockKey, refreshPromise);
  return refreshPromise;
}

async function refreshJumiaClientAccessTokenOnce(
  state: JumiaClientTokenPersistenceState,
  fetchWithThrottle: FetchWithThrottle
): Promise<Partial<JumiaClientTokenPersistenceState>> {
  if (!state.refreshToken?.trim()) {
    const supabase = getScopedSupabaseForPersistence(state);
    const { error: updateError } = await supabase
      .from('marketplace_integrations')
      .update({ sync_error: MISSING_REFRESH_TOKEN_SYNC_ERROR })
      .eq('id', state.integrationId)
      .eq('merchant_id', state.merchantId);

    throw new JumiaApiError(
      401,
      MISSING_REFRESH_TOKEN_SYNC_ERROR,
      updateError ?? undefined
    );
  }

  const supabase = getScopedSupabaseForPersistence(state);
  let refreshLeaseToken: string | null = null;
  let carriedCredentials: CarriedJumiaAuthorizationCredentials | undefined;

  if (state.authorizationId) {
    const leaseResult = await acquireJumiaAuthorizationRefreshLease(
      toRefreshState(state),
      supabase
    );
    if ('reloaded' in leaseResult) {
      return leaseResult.reloaded;
    }
    refreshLeaseToken = leaseResult.leaseToken;
    carriedCredentials = leaseResult.carriedCredentials;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let refreshSucceeded = false;

  try {
    // When a rotation won while this worker waited for the lease, the
    // in-memory refresh token is already consumed; exchange the carried
    // winner credentials instead.
    const exchangeRefreshToken =
      carriedCredentials?.refreshToken ?? state.refreshToken;
    const exchangeClientId = carriedCredentials?.clientId ?? state.clientId;
    const response = await fetchWithThrottle(`${state.apiBase}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: exchangeRefreshToken,
        client_id: exchangeClientId,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new JumiaApiError(response.status, 'Token refresh failed');
    }

    const tokenResponseSchema = state.authorizationId
      ? JumiaSelfAuthorizationTokenResponseSchema
      : JumiaTokenResponseSchema;
    let data: ReturnType<typeof tokenResponseSchema.parse>;
    try {
      data = tokenResponseSchema.parse(await response.json());
    } catch {
      throw new JumiaApiError(
        502,
        state.authorizationId
          ? 'Jumia did not return a rotated refresh token and expiry'
          : 'Jumia returned an invalid token response'
      );
    }
    const tokenExpiresAt = new Date(Date.now() + data.expires_in * 1000);
    const refreshToken =
      data.refresh_token ??
      carriedCredentials?.refreshToken ??
      state.refreshToken;
    const refreshTokenExpiresAt = data.refresh_expires_in
      ? new Date(Date.now() + data.refresh_expires_in * 1000)
      : state.refreshTokenExpiresAt;

    if (state.authorizationId) {
      const selfAuthorizationData =
        JumiaSelfAuthorizationTokenResponseSchema.safeParse(data);
      if (!selfAuthorizationData.success || !refreshLeaseToken) {
        throw new JumiaApiError(
          502,
          'Jumia did not return a rotated refresh token and expiry'
        );
      }
      const persisted = await persistJumiaAuthorizationRotation({
        state: carriedCredentials
          ? {
              ...state,
              clientId: carriedCredentials.clientId,
              authorizationRotationVersion:
                carriedCredentials.authorizationRotationVersion,
            }
          : state,
        supabase,
        refreshLeaseToken,
        data: selfAuthorizationData.data,
        tokenExpiresAt,
        refreshTokenExpiresAt: new Date(
          Date.now() + selfAuthorizationData.data.refresh_expires_in * 1000
        ),
      });
      refreshSucceeded = true;
      return persisted;
    }

    const { error: updateError } = await supabase
      .from('marketplace_integrations')
      .update({
        access_token: data.access_token,
        refresh_token: refreshToken,
        token_expires_at: tokenExpiresAt.toISOString(),
      })
      .eq('id', state.integrationId)
      .eq('merchant_id', state.merchantId);

    if (updateError) {
      throw new JumiaApiError(
        500,
        `Failed to persist refreshed token for integration ${state.integrationId}`,
        updateError
      );
    }

    return {
      accessToken: data.access_token,
      refreshToken,
      tokenExpiresAt,
      refreshTokenExpiresAt,
    };
  } catch (error) {
    let refreshError: unknown = error;
    if (
      (error instanceof Error || error instanceof DOMException) &&
      error.name === 'AbortError'
    ) {
      refreshError = new JumiaApiError(408, 'Token refresh request timed out');
    }
    if (refreshLeaseToken && !refreshSucceeded && state.authorizationId) {
      try {
        await releaseJumiaAuthorizationRefreshLease({
          authorizationId: state.authorizationId,
          merchantId: state.merchantId,
          leaseToken: refreshLeaseToken,
          supabase,
        });
      } catch (releaseError) {
        console.error(
          '[Jumia Client] Failed to release refresh lease after refresh failure',
          releaseError instanceof Error
            ? releaseError.message
            : String(releaseError)
        );
      }
    }
    throw refreshError;
  } finally {
    clearTimeout(timeout);
  }
}
