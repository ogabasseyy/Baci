import { z } from 'zod';

/**
 * piggyvest_primary.read_goal_wallet_setup_health(...) result: an aggregate
 * count only. Strict on every key, so a changed or partial result makes the
 * read count as failed instead of reading as healthy.
 */
const result = z.strictObject({
  generatedAt: z.iso.datetime({ offset: true }),
  staleAfterSeconds: z.int().min(60).max(86400),
  stalledGoalWallets: z.int().nonnegative(),
});

export const piggyvestGoalWalletSetupHealthSchemas = {
  result,
  rows: z.array(z.strictObject({ result })).length(1),
};
