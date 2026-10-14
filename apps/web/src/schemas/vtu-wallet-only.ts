import { z } from 'zod';
import { applyPurchaseRequirements, purchaseSchemaBase } from './vtu';

/**
 * Validation surface for POST /api/vtu/checkout/wallet-only. Extracted
 * from vtu.ts per the Boy Scout rule (that module is over the 300-line
 * budget): wallet-only checkout is the only surviving utility payment
 * path, so its schema lives here.
 *
 * `orderId` is omitted (Codex R96 P1): it is a server-owned linkage
 * field, and prepare persists it as `order_id` without an ownership
 * check — a body-supplied UUID from another storefront would create
 * a cross-tenant association. Neither wallet-only client sends it.
 */
export const vtuWalletOnlyChargeSchema = purchaseSchemaBase
  .extend({
    walletAmount: z
      .number()
      .positive('walletAmount is required for wallet-only checkout'),
    // Auth user id the client captured before dispatch. The route
    // rejects a mismatch before any DB operation: a mid-flight sign-in
    // swaps the ambient cookie, and without this the POST would debit
    // the new account for the old payload. Optional (mobile performs
    // the equivalent check on its own credential client-side); never
    // part of the fingerprint.
    expectedUserId: z.uuid().optional(),
  })
  .omit({ orderId: true })
  .superRefine(applyPurchaseRequirements);

export type VtuWalletOnlyChargeInput = z.infer<
  typeof vtuWalletOnlyChargeSchema
>;
