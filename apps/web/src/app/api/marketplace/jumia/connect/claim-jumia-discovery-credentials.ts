import type { SupabaseClient } from '@supabase/supabase-js';
import { jumiaAuthorizationCrypto } from '@/lib/jumia/authorization-crypto';
import { claimJumiaSelfAuthorizationDiscovery } from '@/lib/jumia/self-authorization-discovery-store';
import { releaseJumiaDiscoveryClaim } from './release-jumia-discovery-claim';

type DecryptedJumiaCredentials = {
  clientId: string;
  refreshToken: string;
  accessToken: string;
};

export async function claimJumiaDiscoveryCredentials(args: {
  discoveryId: string;
  merchantId: string;
  clientKeyHash: string;
  encryptionKey: string;
  supabase: SupabaseClient;
}): Promise<{
  claimToken: string;
  credentialCiphertext: string;
  credentials: DecryptedJumiaCredentials;
} | null> {
  const claim = await claimJumiaSelfAuthorizationDiscovery(args.supabase, {
    discoveryId: args.discoveryId,
    merchantId: args.merchantId,
    clientKeyHash: args.clientKeyHash,
  });
  if (!claim) return null;

  try {
    const credentials = jumiaAuthorizationCrypto.decrypt(
      claim.credentialCiphertext,
      args.encryptionKey,
      jumiaAuthorizationCrypto.buildAuthorizationContext(
        args.merchantId,
        args.clientKeyHash
      )
    );
    return { ...claim, credentials };
  } catch (error) {
    await releaseJumiaDiscoveryClaim({
      discoveryId: args.discoveryId,
      merchantId: args.merchantId,
      claimToken: claim.claimToken,
      supabase: args.supabase,
    });
    throw error;
  }
}
