import 'server-only';
import {
  migratedLegacyWalletEmailLines,
  migratedLegacyWalletPageReason,
  readMigratedLegacyWallets,
} from './daily-reconciliation-legacy-wallets';
import {
  readWalletPaySummary,
  walletPayEmailLines,
  walletPayPageReason,
} from './daily-reconciliation-wallet-pay';

type Execute = (
  statement: string,
  parameters: readonly string[]
) => Promise<{ rows: unknown }>;

export interface SideChecks {
  /** Owner email lines, appended after the main report. */
  lines: string[];
  /** Page reasons; null entries mean that check is clear. */
  reasons: (string | null)[];
}

/**
 * The database-only checks that run beside the main report: wallet pay work
 * that is stuck or owed, and old in-app wallets already moved to PiggyVest
 * that hold money again. Each is read on its own, after the main report, so
 * a failed main report can not hide them; a check that can not be read is
 * reported and paged as unreadable, never as clear.
 */
export async function readSideChecks(input: {
  execute: Execute;
  integrationId: string;
  environment: string;
}): Promise<SideChecks> {
  const walletPay = await readWalletPaySummary(input).catch(() => null);
  const migrated = await readMigratedLegacyWallets(input).catch(() => null);
  return {
    lines: [
      ...walletPayEmailLines(walletPay),
      ...migratedLegacyWalletEmailLines(migrated),
    ],
    reasons: [
      walletPayPageReason(walletPay),
      migratedLegacyWalletPageReason(migrated),
    ],
  };
}
