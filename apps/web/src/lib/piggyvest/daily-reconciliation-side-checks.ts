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

function summarize(
  migrated: Awaited<ReturnType<typeof readMigratedLegacyWallets>> | null,
  walletPay: Awaited<ReturnType<typeof readWalletPaySummary>> | null
): SideChecks {
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

/**
 * The database-only checks that run beside the main report: wallet pay work
 * that is stuck or owed, and old in-app wallets already moved to PiggyVest
 * that hold money again. Each is read on its own (in parallel), after the
 * main report, so a failed main report can not hide them. It never throws: a
 * check that can not be read, or anything unexpected while building the
 * lines, is reported and paged as unreadable, never as clear, so the email
 * and page always go out.
 */
export async function readSideChecks(input: {
  execute: Execute;
  integrationId: string;
  environment: string;
}): Promise<SideChecks> {
  try {
    const [migrated, walletPay] = await Promise.all([
      readMigratedLegacyWallets(input).catch(() => null),
      readWalletPaySummary(input).catch(() => null),
    ]);
    return summarize(migrated, walletPay);
  } catch {
    return summarize(null, null);
  }
}
