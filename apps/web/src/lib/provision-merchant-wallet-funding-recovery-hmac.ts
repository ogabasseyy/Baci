import type { SupabaseClient } from '@supabase/supabase-js';

export function resolveMerchantWalletFundingRecoveryHmacSecret(): string {
  const secret =
    process.env.MERCHANT_WALLET_FUNDING_RECOVERY_HMAC_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error(
      'MERCHANT_WALLET_FUNDING_RECOVERY_HMAC_SECRET is not configured'
    );
  }
  return secret;
}

export async function provisionMerchantWalletFundingRecoveryHmac(
  supabase: SupabaseClient
): Promise<void> {
  const secret = resolveMerchantWalletFundingRecoveryHmacSecret();
  const { error } = await supabase.rpc(
    'set_merchant_wallet_funding_recovery_hmac_secret',
    { p_secret: secret }
  );
  if (error) {
    throw new Error(
      error.message || 'Failed to provision wallet funding recovery HMAC secret'
    );
  }
}
