import type { SupabaseClient } from '@supabase/supabase-js';
import { preserveJumiaSelfAuthorizationDiscoveryAfterRotation } from '@/lib/jumia/self-authorization-discovery-store';

export async function persistJumiaSelectionRotation(args: {
  supabase: SupabaseClient;
  discoveryId: string;
  merchantId: string;
  clientKeyHash: string;
  claimToken: string;
  credentialCiphertext: string;
  expectedRotationVersion?: number;
  expectedRotationVersionRef: { current?: number };
  recoveryDiscoveryIdRef: { current?: string };
}): Promise<void> {
  if (args.expectedRotationVersion !== undefined) {
    args.expectedRotationVersionRef.current = args.expectedRotationVersion;
  }
  const fallbackDiscoveryId =
    await preserveJumiaSelfAuthorizationDiscoveryAfterRotation(args.supabase, {
      discoveryId: args.discoveryId,
      merchantId: args.merchantId,
      clientKeyHash: args.clientKeyHash,
      claimToken: args.claimToken,
      credentialCiphertext: args.credentialCiphertext,
    });
  if (fallbackDiscoveryId)
    args.recoveryDiscoveryIdRef.current = fallbackDiscoveryId;
}
