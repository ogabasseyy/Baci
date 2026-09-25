import type { SupabaseClient } from '@supabase/supabase-js';
import { jumiaAuthorizationCrypto } from '@/lib/jumia/authorization-crypto';
import type { JumiaSelfAuthorizationCredentials } from '@/schemas/jumia/self-authorization';

type RotatedCredentials = JumiaSelfAuthorizationCredentials & {
  accessToken: string;
};

export type PersistedLeasedRotatedJumiaCredentials = {
  credentialCiphertext: string;
  expectedRotationVersion: number;
};

export async function persistRotatedJumiaCredentialsWithLease(args: {
  authorizationId: string;
  authorizationRotationVersion: number;
  clientKeyHash: string;
  credentials: RotatedCredentials;
  encryptionKey: string;
  merchantId: string;
  refreshLeaseToken: string;
  refreshTokenExpiresAt: string;
  supabase: SupabaseClient;
  accessTokenExpiresAt: string;
}): Promise<PersistedLeasedRotatedJumiaCredentials> {
  const credentialCiphertext = jumiaAuthorizationCrypto.encrypt(
    args.credentials,
    args.encryptionKey,
    jumiaAuthorizationCrypto.buildAuthorizationContext(
      args.merchantId,
      args.clientKeyHash
    )
  );
  const { data, error } = await args.supabase.rpc(
    'rotate_jumia_authorization_credentials',
    {
      p_authorization_id: args.authorizationId,
      p_credential_ciphertext: credentialCiphertext,
      p_token_expires_at: args.accessTokenExpiresAt,
      p_refresh_token_expires_at: args.refreshTokenExpiresAt,
      p_expected_rotation_version: args.authorizationRotationVersion,
      p_refresh_lease_token: args.refreshLeaseToken,
    }
  );
  if (error) {
    throw new Error('Failed to persist rotated Jumia authorization');
  }
  if (typeof data !== 'number') {
    throw new Error('Failed to persist rotated Jumia authorization');
  }
  return {
    credentialCiphertext,
    expectedRotationVersion: args.authorizationRotationVersion,
  };
}
