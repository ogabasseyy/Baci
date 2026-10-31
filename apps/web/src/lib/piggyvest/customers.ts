import 'server-only';
import z from 'zod';
import { piggyvestCustomerLookupSchema } from '@/schemas/piggyvest-customer-lookup';
import { type PiggyvestClientConfig, piggyvestRequest } from './client';

/**
 * PiggyVest customer provisioning (sandbox-gated, no live calls).
 *
 * Latest-docs patterns applied:
 * - `returnIfExist=true` plus our `third_party_identifier` make creation
 *   idempotent: retries return `{ new_customer: false }` instead of
 *   duplicating the customer (and its auto-generated default wallet).
 * - BVN is exactly 11 digits; validated before the request leaves.
 * - Creating a customer auto-generates a default wallet and emits
 *   `reserve_virtual_account.success` for its virtual account.
 */

const bvnSchema = z.string().regex(/^\d{11}$/, 'BVN must be exactly 11 digits');

const createCustomerInputSchema = z.object({
  bvn: bvnSchema,
  email: z.email(),
  name: z.string().min(1).max(200),
  phone: z.string().min(7).max(20),
  idType: z
    .enum(['international_passport', 'nin', 'voter_card', 'driver_license'])
    .optional(),
  idNumber: z.string().min(1).max(100).optional(),
  thirdPartyIdentifier: z.string().min(1).max(200),
  returnIfExist: z.boolean().default(true),
  enableInterestAccrual: z.boolean().optional(),
  // Destination for this customer's main-wallet interest. Fixed at creation.
  interestPayoutWallet: z.string().min(1).optional(),
});

export type CreatePiggyvestCustomerInput = z.input<
  typeof createCustomerInputSchema
>;

const createCustomerDataSchema = z.object({
  customer_id: z.string().min(1),
  wallet_id: z.string().min(1),
  new_customer: z.boolean(),
});

export type CreatePiggyvestCustomerResult = z.infer<
  typeof createCustomerDataSchema
>;

export function createPiggyvestCustomer(
  config: PiggyvestClientConfig,
  input: CreatePiggyvestCustomerInput
): Promise<CreatePiggyvestCustomerResult> {
  const parsed = createCustomerInputSchema.parse(input);
  return piggyvestRequest(
    config,
    createCustomerDataSchema,
    '/api/v1/customers',
    {
      body: {
        bvn: parsed.bvn,
        email: parsed.email.toLowerCase(),
        enable_interest_accrual: parsed.enableInterestAccrual,
        id_number: parsed.idNumber,
        id_type: parsed.idType,
        interest_payout_wallet: parsed.interestPayoutWallet,
        name: parsed.name.normalize('NFKC'),
        phone: parsed.phone,
        third_party_identifier: parsed.thirdPartyIdentifier,
      },
      query: { returnIfExist: String(parsed.returnIfExist) },
    }
  );
}

/**
 * Lists the provider customers carrying our third_party_identifier. Read
 * only; callers decide what an empty, single or ambiguous answer proves.
 */
export function findPiggyvestCustomersByThirdPartyIdentifier(
  config: PiggyvestClientConfig,
  thirdPartyIdentifier: string
): Promise<z.infer<typeof piggyvestCustomerLookupSchema>> {
  const identifier = z.string().min(1).max(200).parse(thirdPartyIdentifier);
  return piggyvestRequest(
    config,
    piggyvestCustomerLookupSchema,
    '/api/v1/customers',
    { query: { third_party_identifier: identifier } }
  );
}
