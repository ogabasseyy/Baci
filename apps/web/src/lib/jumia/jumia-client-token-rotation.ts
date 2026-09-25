import type { SupabaseClient } from '@supabase/supabase-js';
import { JumiaApiError } from '@/lib/jumia/helpers';
import { loadJumiaAuthorizationGrant } from '@/lib/jumia/load-jumia-authorization-grant';
import { logger } from '@/lib/logger';
import type { JumiaSelfAuthorizationTokenResponse } from '@/schemas/jumia';
import {
  acquireJumiaAuthorizationRefreshLease,
  type JumiaAuthorizationRefreshState,
  releaseJumiaAuthorizationRefreshLease,
  reloadSharedAuthorizationCredentials,
} from './jumia-authorization-refresh-lease';
import type { JumiaClientTokenPersistenceState } from './jumia-client-token-persistence';

const JUMIA_ROTATION_PERSIST_ATTEMPTS = 3;

async function encryptRotatedCredentials(
  state: JumiaClientTokenPersistenceState,
  refreshToken: string,
  accessToken: string,
  clientKeyHash: string
): Promise<string> {
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
  return jumiaAuthorizationCrypto.encrypt(
    { clientId: state.clientId, refreshToken, accessToken },
    key,
    jumiaAuthorizationCrypto.buildAuthorizationContext(
      state.merchantId,
      clientKeyHash
    )
  );
}

export async function persistJumiaAuthorizationRotation(args: {
  state: JumiaClientTokenPersistenceState;
  supabase: SupabaseClient;
  refreshLeaseToken: string;
  data: JumiaSelfAuthorizationTokenResponse;
  tokenExpiresAt: Date;
  refreshTokenExpiresAt: Date;
}): Promise<Partial<JumiaClientTokenPersistenceState>> {
  const { state, supabase, refreshLeaseToken, data } = args;
  const authorizationId = state.authorizationId;
  if (!authorizationId) {
    throw new JumiaApiError(500, 'Shared Jumia authorization id is required');
  }

  const authorizationGrant = await loadJumiaAuthorizationGrant(
    supabase,
    authorizationId,
    state.merchantId
  );
  const ciphertext = await encryptRotatedCredentials(
    state,
    data.refresh_token,
    data.access_token,
    authorizationGrant.client_key_hash
  );

  let rotationRpcArgs = {
    p_authorization_id: authorizationId,
    p_credential_ciphertext: ciphertext,
    p_token_expires_at: args.tokenExpiresAt.toISOString(),
    p_refresh_token_expires_at: args.refreshTokenExpiresAt.toISOString(),
    p_expected_rotation_version: state.authorizationRotationVersion ?? 1,
    p_refresh_lease_token: refreshLeaseToken,
  };

  let rotationVersion: unknown;
  let updateError: { code?: string; message?: string } | null = null;
  let replacementLeaseToken: string | null = null;
  for (
    let attempt = 1;
    attempt <= JUMIA_ROTATION_PERSIST_ATTEMPTS;
    attempt += 1
  ) {
    const result = await supabase.rpc(
      'rotate_jumia_authorization_credentials',
      rotationRpcArgs
    );
    rotationVersion = result.data;
    updateError = result.error;
    if (!updateError) {
      break;
    }

    const isStaleRotation =
      updateError.code === '40001' ||
      updateError.message?.includes('Stale Jumia authorization rotation');
    if (isStaleRotation) {
      const refreshState: JumiaAuthorizationRefreshState = {
        integrationId: state.integrationId,
        merchantId: state.merchantId,
        authorizationId,
        authorizationRotationVersion: state.authorizationRotationVersion,
        tokenExpiresAt: state.tokenExpiresAt,
        refreshTokenExpiresAt: state.refreshTokenExpiresAt,
      };
      const leaseResult = await acquireJumiaAuthorizationRefreshLease(
        refreshState,
        supabase
      );
      if ('reloaded' in leaseResult) {
        if (replacementLeaseToken) {
          await releaseReplacementLease({
            authorizationId,
            merchantId: state.merchantId,
            leaseToken: replacementLeaseToken,
            supabase,
          });
        }
        return leaseResult.reloaded;
      }
      replacementLeaseToken = leaseResult.leaseToken;
      const expectedRotationVersion =
        refreshState.authorizationRotationVersion ?? 1;
      if (
        leaseResult.authorizationRotationVersion !== undefined &&
        leaseResult.authorizationRotationVersion !== expectedRotationVersion
      ) {
        await releaseReplacementLease({
          authorizationId,
          merchantId: state.merchantId,
          leaseToken: leaseResult.leaseToken,
          supabase,
        });
        return reloadSharedAuthorizationCredentials(
          {
            ...refreshState,
            authorizationRotationVersion:
              leaseResult.authorizationRotationVersion,
          },
          supabase
        );
      }
      rotationRpcArgs = {
        ...rotationRpcArgs,
        p_expected_rotation_version:
          leaseResult.authorizationRotationVersion ?? expectedRotationVersion,
        p_refresh_lease_token: leaseResult.leaseToken,
      };
      // A 40001 can mean that the lease expired after the provider exchange,
      // not that another actor won the rotation. Re-acquire the lease and
      // retry with the same rotated ciphertext instead of discarding it.
      continue;
    }

    if (attempt === JUMIA_ROTATION_PERSIST_ATTEMPTS) {
      if (replacementLeaseToken) {
        await releaseReplacementLease({
          authorizationId,
          merchantId: state.merchantId,
          leaseToken: replacementLeaseToken,
          supabase,
        });
        replacementLeaseToken = null;
      }
      break;
    }
  }

  if (updateError) {
    if (replacementLeaseToken) {
      await releaseReplacementLease({
        authorizationId,
        merchantId: state.merchantId,
        leaseToken: replacementLeaseToken,
        supabase,
      });
    }
    logger.error({
      message: 'Failed to persist rotated Jumia credentials after retrying',
      error: updateError,
      integration_id: state.integrationId,
    });
    throw new JumiaApiError(
      503,
      'Jumia refreshed its credentials, but Baci could not save them. Reconnect Jumia before retrying.'
    );
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    tokenExpiresAt: args.tokenExpiresAt,
    refreshTokenExpiresAt: args.refreshTokenExpiresAt,
    authorizationRotationVersion:
      typeof rotationVersion === 'number'
        ? rotationVersion
        : state.authorizationRotationVersion,
  };
}

async function releaseReplacementLease(args: {
  authorizationId: string;
  merchantId: string;
  leaseToken: string;
  supabase: SupabaseClient;
}): Promise<void> {
  try {
    await releaseJumiaAuthorizationRefreshLease({
      authorizationId: args.authorizationId,
      merchantId: args.merchantId,
      leaseToken: args.leaseToken,
      supabase: args.supabase,
    });
  } catch (error) {
    logger.error({
      message: 'Failed to release replacement Jumia refresh lease',
      integration_id: args.merchantId,
      error,
    });
  }
}
