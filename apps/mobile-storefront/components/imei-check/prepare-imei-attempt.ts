import type { ImeiServiceTierKey } from '@baci/shared/imei';
import { acquireImeiRecoveryKey } from '@/lib/imei-request-recovery';

export async function prepareImeiAttempt({
  scope,
  tier,
  identifier,
  price,
  balance,
  walletLoading,
  walletError,
  createKey,
}: {
  scope: string;
  tier: ImeiServiceTierKey;
  identifier: string;
  price: number;
  balance: number;
  walletLoading: boolean;
  walletError: boolean;
  createKey: () => string;
}) {
  let recovery: Awaited<ReturnType<typeof acquireImeiRecoveryKey>>;
  try {
    recovery = await acquireImeiRecoveryKey(
      [scope, tier, identifier],
      createKey
    );
  } catch {
    return { kind: 'storage_error' as const };
  }
  // Keep a newly prepared key even if local balance checks fail: another
  // mounted screen may already have started submitting the same key.
  if (!recovery.isExisting) {
    if (walletLoading) return { kind: 'wallet_loading' as const };
    if (walletError) return { kind: 'wallet_error' as const };
    if (balance < price)
      return { kind: 'insufficient' as const, shortfall: price - balance };
  }
  return { kind: 'ready' as const, recovery };
}
