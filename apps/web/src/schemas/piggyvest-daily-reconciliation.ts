// Zod 4 (pinned 4.6.6) provides z.uuid(), z.int(), z.email() and
// z.iso.datetime() as top-level helpers; the schema test pins their presence.
import { z } from 'zod';
import { piggyvestProviderIdSchema } from './piggyvest-provider-id';

/** A transfer still reserved or dispatched past the stale cutoff. */
const stuckTransfer = z.strictObject({
  operationId: z.uuid(),
  goalId: z.uuid(),
  state: z.enum(['reserved', 'dispatched']),
  amountKobo: z.int().positive().max(9999999999),
  sourceWalletId: piggyvestProviderIdSchema,
  destinationWalletId: piggyvestProviderIdSchema,
  reference: z.string().min(1).max(200),
  ageSeconds: z.int().nonnegative(),
});

const expectedWallet = z.strictObject({
  walletId: piggyvestProviderIdSchema,
  expectedKobo: z.int().nonnegative(),
});

/**
 * piggyvest_primary.read_daily_reconciliation(...) result. Strict on every
 * key: an unexpected or missing key makes the whole snapshot unusable, which
 * the job reports as a failure instead of reading it as clean.
 */
const snapshot = z.strictObject({
  generatedAt: z.iso.datetime({ offset: true }),
  staleAfterSeconds: z.int().min(60).max(604800),
  businessId: piggyvestProviderIdSchema,
  stuck: z.array(stuckTransfer).max(200),
  stuckTotal: z.int().nonnegative(),
  wallets: z.array(expectedWallet).max(500),
  walletsTotal: z.int().nonnegative(),
});

export const piggyvestDailyReconciliationSchemas = {
  stuckTransfer,
  expectedWallet,
  snapshot,
  snapshotRows: z.array(z.strictObject({ result: snapshot })).length(1),
  // The owner address the report is emailed to.
  reportEmail: z.email().max(254),
};

export type PiggyvestReconciliationSnapshot = z.infer<typeof snapshot>;
export type PiggyvestStuckTransfer = z.infer<typeof stuckTransfer>;
