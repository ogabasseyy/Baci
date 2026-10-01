import 'server-only';

import {
  createServiceClient,
  type WalletFundingRecoveryServiceClient,
} from '@/lib/supabase/service';

/**
 * Owner-approved temporary wallet funding-recovery HMAC boundary (2026-09-06).
 * Only the CRON_SECRET-authenticated
 * `/api/cron/provision-wallet-funding-recovery-hmac` route may call this. The
 * client is limited to `set_merchant_wallet_funding_recovery_hmac_secret`.
 * Remove this exception by 2026-09-16 or when a restricted worker role exists.
 */
export function createWalletFundingRecoveryHmacServiceClient(): WalletFundingRecoveryServiceClient {
  return createServiceClient('wallet-funding-recovery');
}

export type { WalletFundingRecoveryServiceClient } from '@/lib/supabase/service';
