import z from 'zod';

/**
 * Wire shape of piggyvest_primary.read_house_wallets
 * (supabase/migrations/20261102202401_piggyvest_primary_engine_schema.sql).
 * House wallets are Ogabassey's own PiggyVest wallets, never a customer's.
 * The database is the authority; these schemas only refuse to act on a
 * response that does not look like it.
 */
export const houseWalletRoleSchema = z.enum(['collection', 'interest', 'fee']);

export type HouseWalletRole = z.infer<typeof houseWalletRoleSchema>;

export const houseWalletRowSchema = z.strictObject({
  role: houseWalletRoleSchema,
  provider_wallet_id: z.string().min(1).max(512),
  business_id: z.string().min(1).max(512),
  // The registry only holds NGN wallets; the provider transfer reader binds
  // NGN from them when a transfer record names no currency.
  currency: z.literal('NGN'),
  enabled: z.boolean(),
  verified: z.boolean(),
});

export type HouseWalletRow = z.infer<typeof houseWalletRowSchema>;

/** One row per role at most: the registry is unique on (integration, role). */
export const houseWalletRowsSchema = z.array(houseWalletRowSchema).max(3);

export const houseWalletIntegrationIdSchema = z.uuid();
