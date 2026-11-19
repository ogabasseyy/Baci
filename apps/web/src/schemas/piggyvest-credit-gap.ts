import { z } from 'zod';
import { piggyvestProviderIdSchema } from './piggyvest-provider-id';

/**
 * piggyvest_primary.read_credit_gap_ledger(...) result: per mapped plan
 * wallet, the PVB credit ids (`pvb_reference`) both credit ledgers recorded
 * since shortly before the window start. Strict on every key: anything
 * unexpected makes the read unusable, which the job reports as unchecked
 * instead of reading it as "nothing recorded".
 */
const recordedCredit = z.strictObject({
  reference: piggyvestProviderIdSchema,
  at: z.iso.datetime({ offset: true }),
});

const ledgerWallet = z.strictObject({
  walletId: piggyvestProviderIdSchema,
  inflow: z.array(recordedCredit).max(1000),
  inflowTruncated: z.boolean(),
  interest: z.array(recordedCredit).max(1000),
  interestTruncated: z.boolean(),
  unkeyed: z.int().nonnegative(),
});

const ledgerSnapshot = z
  .strictObject({
    generatedAt: z.iso.datetime({ offset: true }),
    windowStart: z.iso.datetime({ offset: true }),
    businessId: piggyvestProviderIdSchema,
    wallets: z.array(ledgerWallet).max(100),
    walletsTotal: z.int().nonnegative(),
    walletsDeferred: z.int().nonnegative(),
  })
  .refine(
    (value) =>
      value.walletsDeferred === value.walletsTotal - value.wallets.length &&
      Date.parse(value.windowStart) < Date.parse(value.generatedAt),
    { message: 'deferred count or window is inconsistent' }
  );

export const piggyvestCreditGapSchemas = {
  ledgerWallet,
  ledgerSnapshot,
  ledgerRows: z.array(z.strictObject({ result: ledgerSnapshot })).length(1),
};

export type CreditGapLedgerSnapshot = z.infer<typeof ledgerSnapshot>;
export type CreditGapLedgerWallet = z.infer<typeof ledgerWallet>;
