import type { SupabaseClient } from '@supabase/supabase-js';
import { JumiaApiError } from '@/lib/jumia/helpers';
import { loadJumiaAuthorizationGrant } from '@/lib/jumia/load-jumia-authorization-grant';

export const REFRESH_LEASE_SECONDS = 45;
export const REFRESH_LEASE_BUSY_RETRIES = 10;
export const REFRESH_LEASE_BUSY_DELAY_MS = 500;

export type JumiaAuthorizationRefreshState = {
  integrationId: string;
  merchantId: string;
  authorizationId: string;
  authorizationRotationVersion?: number;
  tokenExpiresAt: Date | null;
  refreshTokenExpiresAt?: Date | null;
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function claimJumiaAuthorizationRefreshLease(
  state: JumiaAuthorizationRefreshState,
  _supabase: SupabaseClient
): Promise<
  | { status: 'claimed'; leaseToken: string }
  | { status: 'busy' }
  | { status: 'stale' }
> {
  const { data, error } = await _supabase.rpc(
    'claim_jumia_authorization_refresh_lease',
    {
      p_authorization_id: state.authorizationId,
      p_merchant_id: state.merchantId,
      p_expected_rotation_version: state.authorizationRotationVersion ?? 1,
      p_lease_seconds: REFRESH_LEASE_SECONDS,
    }
  );

  if (!error && typeof data === 'string') {
    return { status: 'claimed', leaseToken: data };
  }

  if (
    error?.code === '40001' ||
    error?.message?.includes('Stale Jumia authorization rotation')
  ) {
    return { status: 'stale' };
  }

  if (error?.code === '42501') {
    throw new JumiaApiError(
      403,
      'Jumia credential refresh requires integrations.manage permission; reconnect or ask a manager',
      error
    );
  }

  if (
    error?.code === '55P03' ||
    error?.message?.includes('refresh already in progress')
  ) {
    return { status: 'busy' };
  }

  throw new JumiaApiError(
    500,
    `Failed to claim Jumia refresh lease for integration ${state.integrationId}`,
    error ?? undefined
  );
}

export async function releaseJumiaAuthorizationRefreshLease(args: {
  authorizationId: string;
  merchantId: string;
  leaseToken: string;
  supabase: SupabaseClient;
}): Promise<boolean> {
  const { data, error } = await args.supabase.rpc(
    'release_jumia_authorization_refresh_lease',
    {
      p_authorization_id: args.authorizationId,
      p_merchant_id: args.merchantId,
      p_refresh_lease_token: args.leaseToken,
    }
  );
  if (error) {
    throw new JumiaApiError(
      500,
      'Failed to release Jumia authorization refresh lease',
      error
    );
  }
  return data === true;
}

export async function reloadSharedAuthorizationCredentials(
  state: JumiaAuthorizationRefreshState,
  supabase: SupabaseClient
): Promise<{
  accessToken: string;
  refreshToken: string;
  clientId: string;
  tokenExpiresAt: Date;
  authorizationRotationVersion: number;
  refreshTokenExpiresAt: Date;
}> {
  const { getJumiaAuthorizationEncryptionKey } = await import('@/env');
  const { jumiaAuthorizationCrypto } = await import(
    '@/lib/jumia/authorization-crypto'
  );
  const key = getJumiaAuthorizationEncryptionKey();
  if (!key) {
    throw new JumiaApiError(
      500,
      'Jumia authorization encryption is not configured'
    );
  }

  const authorization = await loadJumiaAuthorizationGrant(
    supabase,
    state.authorizationId,
    state.merchantId
  );

  const refreshTokenExpiresAt = authorization.refresh_token_expires_at;
  if (!refreshTokenExpiresAt) {
    throw new JumiaApiError(
      500,
      'Jumia authorization refresh-token expiry is unavailable'
    );
  }

  const credentials = jumiaAuthorizationCrypto.decrypt(
    authorization.credential_ciphertext,
    key,
    jumiaAuthorizationCrypto.buildAuthorizationContext(
      state.merchantId,
      authorization.client_key_hash
    )
  );

  return {
    accessToken: credentials.accessToken,
    refreshToken: credentials.refreshToken,
    clientId: credentials.clientId,
    tokenExpiresAt: new Date(authorization.token_expires_at),
    refreshTokenExpiresAt: new Date(refreshTokenExpiresAt),
    authorizationRotationVersion: authorization.rotation_version,
  };
}

function hasFreshSharedCredentials(
  state: JumiaAuthorizationRefreshState,
  reloaded: {
    tokenExpiresAt: Date;
    authorizationRotationVersion: number;
  }
): boolean {
  const startVersion = state.authorizationRotationVersion ?? 1;
  const tokenIsFresh =
    reloaded.tokenExpiresAt.getTime() >
    Math.max(Date.now(), state.tokenExpiresAt?.getTime() ?? 0);
  if (reloaded.authorizationRotationVersion > startVersion) {
    return tokenIsFresh;
  }

  return tokenIsFresh;
}

export type CarriedJumiaAuthorizationCredentials = {
  refreshToken: string;
  clientId: string;
  authorizationRotationVersion: number;
};

export async function acquireJumiaAuthorizationRefreshLease(
  state: JumiaAuthorizationRefreshState,
  supabase: SupabaseClient
): Promise<
  | {
      leaseToken: string;
      authorizationRotationVersion?: number;
      carriedCredentials?: CarriedJumiaAuthorizationCredentials;
    }
  | {
      reloaded: Awaited<
        ReturnType<typeof reloadSharedAuthorizationCredentials>
      >;
    }
> {
  let currentState = state;
  // When another worker wins the rotation while this caller waits, the
  // caller's in-memory refresh token is already consumed. Carry the
  // winner's reloaded credentials into the retry so the eventual exchange
  // submits a live token instead of the stale original.
  const startVersion = state.authorizationRotationVersion ?? 1;
  let carriedCredentials: CarriedJumiaAuthorizationCredentials | undefined;

  for (let attempt = 0; attempt < REFRESH_LEASE_BUSY_RETRIES; attempt += 1) {
    const claim = await claimJumiaAuthorizationRefreshLease(
      currentState,
      supabase
    );
    if (claim.status === 'claimed') {
      return {
        leaseToken: claim.leaseToken,
        authorizationRotationVersion: currentState.authorizationRotationVersion,
        ...(carriedCredentials ? { carriedCredentials } : {}),
      };
    }

    if (claim.status === 'stale') {
      const reloaded = await reloadSharedAuthorizationCredentials(
        currentState,
        supabase
      );
      if (hasFreshSharedCredentials(currentState, reloaded)) {
        return { reloaded };
      }
      if (reloaded.authorizationRotationVersion > startVersion) {
        carriedCredentials = {
          refreshToken: reloaded.refreshToken,
          clientId: reloaded.clientId,
          authorizationRotationVersion: reloaded.authorizationRotationVersion,
        };
      }
      currentState = {
        ...currentState,
        authorizationRotationVersion: reloaded.authorizationRotationVersion,
        tokenExpiresAt: reloaded.tokenExpiresAt,
        refreshTokenExpiresAt: reloaded.refreshTokenExpiresAt,
      };
      continue;
    }

    const reloaded = await reloadSharedAuthorizationCredentials(
      currentState,
      supabase
    );
    if (hasFreshSharedCredentials(currentState, reloaded)) {
      return { reloaded };
    }
    if (reloaded.authorizationRotationVersion > startVersion) {
      carriedCredentials = {
        refreshToken: reloaded.refreshToken,
        clientId: reloaded.clientId,
        authorizationRotationVersion: reloaded.authorizationRotationVersion,
      };
    }

    if (attempt < REFRESH_LEASE_BUSY_RETRIES - 1) {
      await delay(REFRESH_LEASE_BUSY_DELAY_MS * (attempt + 1));
    }
  }

  throw new JumiaApiError(
    503,
    'Jumia credential refresh is still in progress. Retry shortly.'
  );
}
