import type { PiggyvestLegacyMigratedWallets } from '@/schemas/piggyvest-legacy-migrated-wallets';

/** Wallet ids shown in the email; the rest are counted. */
const EMAIL_WALLET_LIMIT = 10;

/** Owner email lines for moved legacy wallets (null = could not be read). */
export function migratedLegacyWalletEmailLines(
  summary: PiggyvestLegacyMigratedWallets | null
): string[] {
  if (!summary)
    return [
      'Moved legacy wallets could not be read: run the runbook balance list and check already_migrated wallets by hand.',
    ];
  if (summary.count === 0)
    return ['Moved legacy wallets: none hold money again.'];
  const shown = summary.wallets.slice(0, EMAIL_WALLET_LIMIT);
  const hidden = summary.count - shown.length;
  return [
    `Moved legacy wallets holding money again: ${summary.count} (NGN ${summary.totalBalance} in all).`,
    'They were already paid in PiggyVest once: never credit PiggyVest a second time. Resolve each by hand (docs/piggyvest-legacy-migration-runbook.md).',
    ...shown.map(
      (wallet) => `Wallet ${wallet.walletId}: NGN ${wallet.balance}`
    ),
    ...(hidden > 0
      ? [`And ${hidden} more (see the runbook balance list).`]
      : []),
  ];
}

/** The page reason; null when no moved wallet holds money. */
export function migratedLegacyWalletPageReason(
  summary: PiggyvestLegacyMigratedWallets | null
): string | null {
  if (!summary) return 'legacy_migrated_unreadable';
  return summary.count === 0
    ? null
    : `legacy_migrated_with_balance=${summary.count}`;
}
