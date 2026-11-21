import 'server-only';
import { z } from 'zod';

type Execute = (
  statement: string,
  parameters: readonly string[]
) => Promise<{ rows: unknown }>;

export const MIGRATED_LEGACY_WALLETS_STATEMENT =
  'SELECT piggyvest_primary.read_migrated_legacy_wallet_balances($1::uuid,$2::text,$3::jsonb) AS result';

const naira = z.string().regex(/^\d{1,14}\.\d{2}$/);
const reportRows = z
  .array(
    z.object({
      result: z.object({
        count: z.number().int().nonnegative(),
        totalBalance: naira,
        wallets: z
          .array(z.object({ walletId: z.string().uuid(), balance: naira }))
          .max(50),
      }),
    })
  )
  .length(1);

export interface MigratedLegacyWallets {
  count: number;
  totalBalance: string;
  wallets: { walletId: string; balance: string }[];
}

/** Wallet ids shown in the email; the rest are counted. */
const EMAIL_WALLET_LIMIT = 10;

/**
 * Old in-app wallets already moved to PiggyVest by hand (S10 runbook) that
 * hold money again, for example after a late refund. Read-only (evidence
 * login), scoped to the integration's own merchant, and it never moves money.
 * An unreadable answer throws so the run is never reported as all clear.
 */
export async function readMigratedLegacyWallets(input: {
  execute: Execute;
  integrationId: string;
  environment: string;
}): Promise<MigratedLegacyWallets> {
  const { rows } = await input.execute(MIGRATED_LEGACY_WALLETS_STATEMENT, [
    input.integrationId,
    input.environment,
    '{}',
  ]);
  return reportRows.parse(rows)[0].result;
}

/** Owner email lines (null = could not be read). */
export function migratedLegacyWalletEmailLines(
  summary: MigratedLegacyWallets | null
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
  summary: MigratedLegacyWallets | null
): string | null {
  if (!summary) return 'legacy_migrated_unreadable';
  return summary.count === 0
    ? null
    : `legacy_migrated_with_balance=${summary.count}`;
}
