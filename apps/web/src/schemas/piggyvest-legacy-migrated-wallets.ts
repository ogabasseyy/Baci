import { z } from 'zod';

const naira = z.string().regex(/^\d{1,14}\.\d{2}$/);

/**
 * piggyvest_primary.read_migrated_legacy_wallet_balances(...) rows: old
 * in-app wallets already moved to PiggyVest by hand that hold money again.
 * Strict: any unexpected or missing key makes the answer unusable, which the
 * daily reconciliation reports as unreadable instead of clear.
 */
export const piggyvestLegacyMigratedWalletRowsSchema = z
  .array(
    z.strictObject({
      result: z.strictObject({
        count: z.int().nonnegative(),
        totalBalance: naira,
        wallets: z
          .array(z.strictObject({ walletId: z.uuid(), balance: naira }))
          .max(50),
      }),
    })
  )
  .length(1);

export type PiggyvestLegacyMigratedWallets = z.infer<
  typeof piggyvestLegacyMigratedWalletRowsSchema
>[number]['result'];
