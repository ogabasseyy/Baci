import 'server-only';
import { piggyvestProviderIdSchema } from '@/schemas/piggyvest-provider-id';
import { isPiggyvestFeatureOn } from './piggyvest-feature-on';
import type { PiggyvestSwitchEnv } from './piggyvest-kill-switch';
import { readPrimaryWalletSavingsRecoveryRuntime } from './primary-wallet-savings-runtime';

/**
 * Ogabassey's PiggyVest collection wallet, from server configuration only. The
 * database row (piggyvest_primary.collection_wallets) must name the same
 * wallet: the transfer and refund steps refuse any reservation whose wallet
 * differs, so neither a bad deploy value nor a bad row alone redirects money.
 */
function readCollectionWalletId(env: PiggyvestSwitchEnv): string {
  return piggyvestProviderIdSchema.parse(env.PIGGYVEST_COLLECTION_WALLET_ID);
}

function build(env: PiggyvestSwitchEnv) {
  const primary = readPrimaryWalletSavingsRecoveryRuntime(
    env as NodeJS.ProcessEnv
  );
  return { ...primary, collectionWalletId: readCollectionWalletId(env) };
}

/**
 * New payments (issue, PIN, reserve, send). Off unless the wallet flag and
 * PIGGYVEST_WALLET_PAY_ENABLED are both exactly "true" and the master kill
 * switch is not set. On but misconfigured throws, so routes answer 503.
 */
export function readWalletPayRuntime(env: PiggyvestSwitchEnv = process.env) {
  if (
    !isPiggyvestFeatureOn('wallet', env) ||
    !isPiggyvestFeatureOn('wallet_pay', env)
  )
    return null;
  return build(env);
}

/**
 * Status checks, settlement, delivery of confirmed payments and refunds. It
 * ignores both flags and the kill switch: switching wallet pay off must never
 * strand a payment PiggyVest accepted or a refund we owe. It never starts a
 * new payment. Misconfiguration throws, so the drain pages rather than skips.
 */
export function readWalletPayRecoveryRuntime(
  env: PiggyvestSwitchEnv = process.env
) {
  return build(env);
}

export type WalletPayRuntime = ReturnType<typeof build>;
