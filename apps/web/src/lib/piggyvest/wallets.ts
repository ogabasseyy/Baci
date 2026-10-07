import 'server-only';
import z from 'zod';
import { type PiggyvestClientConfig, piggyvestRequest } from './client';

/**
 * PiggyVest plan-wallet provisioning (sandbox-gated, no live calls).
 *
 * Latest-docs patterns applied:
 * - Creation is asynchronous: the POST returns only a wallet id; the
 *   `create-wallet.success` webhook (or a retrieve poll) confirms readiness.
 *   Never display funding instructions until provisioning succeeds.
 * - `subaccount_name` is provider-unique — derive it deterministically from
 *   our plan id so retries cannot mint duplicate wallets.
 * - `reserve_virtual_account: true` on creation; interest accrual is opt-in.
 */

const koboSchema = z.int().nonnegative();

const createWalletInputSchema = z.object({
  subaccountName: z.string().min(1).max(200),
  customerId: z.string().min(1),
  reserveVirtualAccount: z.literal(true),
  enableInterestAccrual: z.boolean().default(false),
  interestPayoutWallet: z.string().min(1).optional(),
});

export type CreatePiggyvestWalletInput = z.input<
  typeof createWalletInputSchema
>;

const createWalletDataSchema = z.object({ id: z.string().min(1) });

const retrieveWalletDataSchema = z.object({
  id: z.string().min(1),
  business_id: z.string().min(1),
  virtual_account_id: z.string().nullable().optional(),
  currency: z.literal('NGN'),
  name: z.string(),
  status: z.string().min(1),
  type: z.string().min(1),
  balance: koboSchema,
  withdrawal_count: z.int().nonnegative(),
  creation_interest_rate: z.number(),
  current_interest_rate: z.number(),
});

export type RetrievePiggyvestWalletResult = z.infer<
  typeof retrieveWalletDataSchema
>;

export function createPiggyvestWallet(
  config: PiggyvestClientConfig,
  input: CreatePiggyvestWalletInput
): Promise<{ id: string }> {
  const parsed = createWalletInputSchema.parse(input);
  return piggyvestRequest(
    config,
    createWalletDataSchema,
    '/api/v1/wallet/sub-account',
    {
      body: {
        subaccount_name: parsed.subaccountName,
        reserve_virtual_account: true,
        customer_id: parsed.customerId,
        enable_interest_accrual: parsed.enableInterestAccrual,
        interest_payout_wallet: parsed.interestPayoutWallet,
      },
    }
  );
}

export function retrievePiggyvestWallet(
  config: PiggyvestClientConfig,
  walletId: string
): Promise<RetrievePiggyvestWalletResult> {
  const id = z.string().min(1).parse(walletId);
  return piggyvestRequest(
    config,
    retrieveWalletDataSchema,
    `/api/v1/wallet/${encodeURIComponent(id)}`
  );
}

const walletListEdgeSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string(),
  status: z.string().min(1),
});

export type PiggyvestWalletListEdge = z.infer<typeof walletListEdgeSchema>;

const listWalletsDataSchema = z.object({
  paginatedPayload: z.looseObject({
    edges: z.array(walletListEdgeSchema),
  }),
});

const listWalletsInputSchema = z.object({
  customerId: z.string().min(1).optional(),
  limit: z.int().positive().max(100).default(20),
});

export type ListPiggyvestWalletsInput = z.input<typeof listWalletsInputSchema>;

/**
 * Lists API wallets, optionally filtered by customer. Primary consumer is
 * create-time reconciliation: a POST that times out may still have minted
 * the wallet (observed live on staging), so callers match by the
 * deterministic subaccount name instead of blindly retrying the create.
 */
export async function listPiggyvestWallets(
  config: PiggyvestClientConfig,
  input: ListPiggyvestWalletsInput = {}
): Promise<PiggyvestWalletListEdge[]> {
  const parsed = listWalletsInputSchema.parse(input);
  const data = await piggyvestRequest(
    config,
    listWalletsDataSchema,
    '/api/v1/wallet/api/wallet-type',
    {
      query: {
        limit: String(parsed.limit),
        customer_id: parsed.customerId,
      },
    }
  );
  return data.paginatedPayload.edges;
}
