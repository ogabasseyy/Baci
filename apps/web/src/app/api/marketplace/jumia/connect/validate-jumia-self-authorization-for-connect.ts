import type { SupabaseClient } from '@supabase/supabase-js';
import { releaseJumiaAuthorizationRefreshLease } from '@/lib/jumia/jumia-authorization-refresh-lease';
import { validateJumiaSelfAuthorization } from '@/lib/jumia/self-authorization';
import type { JumiaSelfAuthorizationCredentials } from '@/schemas/jumia/self-authorization';
import { claimJumiaResumedAuthorization } from './claim-jumia-resumed-authorization';
import { persistRotatedJumiaCredentials } from './persist-rotated-jumia-credentials';
import { persistRotatedJumiaCredentialsWithLease } from './persist-rotated-jumia-credentials-with-lease';

type ValidatedSelfAuthorization = Awaited<
  ReturnType<typeof validateJumiaSelfAuthorization>
>;

export async function validateJumiaSelfAuthorizationForConnect(args: {
  clientKeyHash: string;
  discoveryId?: string;
  encryptionKey: string;
  merchantId: string;
  onCredentialsRotated: (value: {
    credentialCiphertext: string;
    expectedRotationVersion?: number;
  }) => Promise<void>;
  submittedCredentials: JumiaSelfAuthorizationCredentials;
  supabase: SupabaseClient;
}): Promise<ValidatedSelfAuthorization> {
  // A fresh discovery whose credentials already back an active grant must
  // serialize its exchange with worker refreshes just like a resumed one.
  // The fresh-discovery claim is best-effort: an unreadable stored grant
  // must not block explicit reauthorization with submitted credentials.
  let authorizationLease: Awaited<
    ReturnType<typeof claimJumiaResumedAuthorization>
  >;
  if (args.discoveryId) {
    authorizationLease = await claimJumiaResumedAuthorization({
      clientKeyHash: args.clientKeyHash,
      encryptionKey: args.encryptionKey,
      merchantId: args.merchantId,
      supabase: args.supabase,
    });
  } else {
    try {
      authorizationLease = await claimJumiaResumedAuthorization({
        clientKeyHash: args.clientKeyHash,
        encryptionKey: args.encryptionKey,
        merchantId: args.merchantId,
        supabase: args.supabase,
      });
    } catch (error) {
      console.error(
        '[Jumia Connect] Continuing fresh discovery without a refresh lease:',
        error instanceof Error ? error.message : String(error)
      );
      authorizationLease = null;
    }
  }
  // A fresh, explicit credential submission is a reauthorization attempt and
  // must not be replaced by an expired stored grant. Resumed discoveries have
  // already committed to the stored authorization, so they use the leased
  // winner while preserving refresh serialization for both paths.
  const submittedCredentials =
    args.discoveryId && authorizationLease
      ? authorizationLease.credentials
      : args.submittedCredentials;

  let credentialsRotated = false;
  try {
    const result = await validateJumiaSelfAuthorization(submittedCredentials, {
      onCredentialsRotated: async ({
        credentials,
        accessTokenExpiresAt,
        refreshTokenExpiresAt,
      }) => {
        const persisted = authorizationLease
          ? await persistRotatedJumiaCredentialsWithLease({
              authorizationId: authorizationLease.authorizationId,
              authorizationRotationVersion:
                authorizationLease.authorizationRotationVersion,
              clientKeyHash: args.clientKeyHash,
              credentials,
              encryptionKey: args.encryptionKey,
              merchantId: args.merchantId,
              refreshLeaseToken: authorizationLease.leaseToken,
              refreshTokenExpiresAt,
              supabase: args.supabase,
              accessTokenExpiresAt,
            })
          : await persistRotatedJumiaCredentials({
              credentials,
              encryptionKey: args.encryptionKey,
              supabase: args.supabase,
              merchantId: args.merchantId,
              clientKeyHash: args.clientKeyHash,
              accessTokenExpiresAt,
              refreshTokenExpiresAt,
            });
        // The lease-protected RPC clears the lease before the outer callback
        // runs. Only failures before that point need an explicit release.
        credentialsRotated = true;
        await args.onCredentialsRotated(persisted);
      },
    });
    // The normal self-authorization exchange rotates credentials and clears
    // the lease through the lease-protected persistence RPC. Keep the lease
    // lifecycle safe for providers/tests that return without rotating.
    if (authorizationLease && !credentialsRotated) {
      await releaseJumiaAuthorizationRefreshLease({
        authorizationId: authorizationLease.authorizationId,
        merchantId: args.merchantId,
        leaseToken: authorizationLease.leaseToken,
        supabase: args.supabase,
      });
    }
    return result;
  } catch (error) {
    if (authorizationLease && !credentialsRotated) {
      try {
        await releaseJumiaAuthorizationRefreshLease({
          authorizationId: authorizationLease.authorizationId,
          merchantId: args.merchantId,
          leaseToken: authorizationLease.leaseToken,
          supabase: args.supabase,
        });
      } catch (releaseError) {
        console.error(
          '[Jumia Connect] Failed to release refresh lease after validation failure:',
          releaseError
        );
      }
    }
    throw error;
  }
}
