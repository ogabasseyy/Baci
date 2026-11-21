import 'server-only';
import { readMigratedLegacyWallets } from './daily-reconciliation-legacy-wallets';
import {
  migratedLegacyWalletEmailLines,
  migratedLegacyWalletPageReason,
} from './daily-reconciliation-legacy-wallets-report';
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
  /**
   * Page reasons, most urgent first (an already-paid wallet holding money
   * again before wallet pay work); null entries mean that check is clear.
   */
  reasons: (string | null)[];
  /** True when any side check pages, so the email never reads all clear. */
  attention: boolean;
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
  const reasons = [
    migratedLegacyWalletPageReason(migrated),
    walletPayPageReason(walletPay),
  ];
  return {
    lines: [
      ...migratedLegacyWalletEmailLines(migrated),
      ...walletPayEmailLines(walletPay),
    ],
    reasons,
    attention: reasons.some((reason) => reason !== null),
  };
}
