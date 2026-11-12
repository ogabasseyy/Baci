import 'server-only';
import { z } from 'zod';
import { WALLET_PAY_EVIDENCE_STATEMENTS as sql } from './wallet-pay-statements';

type Execute = (
  statement: string,
  parameters: readonly string[]
) => Promise<{ rows: unknown }>;

const line = z.array(z.object({ operationId: z.string() })).max(200);
const reportRows = z
  .array(
    z.object({
      result: z.object({
        stuckPayments: line,
        undelivered: line,
        unrefunded: line,
        needsReview: line,
      }),
    })
  )
  .length(1);

export interface WalletPaySummary {
  stuck: number;
  undelivered: number;
  unrefunded: number;
  review: number;
}

/**
 * Wallet pay part of the daily reconciliation: payments stuck before
 * settling, paid-but-undelivered purchases, owed refunds not yet sent, and
 * everything waiting for a person. Read-only (evidence login); an unreadable
 * answer throws so the run never reports it as all clear.
 */
export async function readWalletPaySummary(input: {
  execute: Execute;
  integrationId: string;
  environment: string;
}): Promise<WalletPaySummary> {
  const { rows } = await input.execute(sql.reconciliation, [
    input.integrationId,
    input.environment,
    '{}',
  ]);
  const result = reportRows.parse(rows)[0].result;
  return {
    stuck: result.stuckPayments.length,
    undelivered: result.undelivered.length,
    unrefunded: result.unrefunded.length,
    review: result.needsReview.length,
  };
}

/** One line per outstanding kind for the owner email (null = unreadable). */
export function walletPayEmailLines(summary: WalletPaySummary | null) {
  if (!summary)
    return ['PiggyVest wallet payments could not be read: check them by hand.'];
  if (Object.values(summary).every((count) => count === 0))
    return ['PiggyVest wallet payments: nothing outstanding.'];
  return [
    'PiggyVest wallet payments (older than 30 minutes, ids in the database report):',
    `Stuck before settling: ${summary.stuck}`,
    `Paid but not delivered: ${summary.undelivered}`,
    `Refund owed, not yet sent: ${summary.unrefunded}`,
    `Waiting for a person (fee, late success, review): ${summary.review}`,
  ];
}

/** The page reason for wallet pay; null when nothing is outstanding. */
export function walletPayPageReason(summary: WalletPaySummary | null) {
  if (!summary) return 'wallet_pay_unreadable';
  if (Object.values(summary).every((count) => count === 0)) return null;
  return `wallet_pay stuck=${summary.stuck} undelivered=${summary.undelivered} unrefunded=${summary.unrefunded} review=${summary.review}`;
}
