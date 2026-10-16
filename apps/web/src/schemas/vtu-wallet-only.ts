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
 * `customerId` is omitted alongside it (Muse R110 LOW): no
 * wallet-only reader consumes it today, but it is the same class of
 * server-owned linkage, and a future reader would reopen exactly
 * the cross-tenant hole the `orderId` omission closes.
 */
export const vtuWalletOnlyChargeSchema = purchaseSchemaBase
  .extend({
    walletAmount: z
      .number()
      .positive('walletAmount is required for wallet-only checkout'),
    // Auth user id the client captured before dispatch. The route
    // rejects a mismatch before any DB operation: a mid-flight sign-in
    // swaps the ambient cookie, and without this the POST would debit
    // the new account for the old payload. Required (Muse R124):
    // both first-party clients always send it (web's readiness gate
    // requires the user; mobile's submitter binding throws without
    // it), so an omission is a hand-crafted request that must not
    // silently lose the binding. Never part of the fingerprint.
    expectedUserId: z.uuid(),
  })
  .omit({ orderId: true, customerId: true })
  .superRefine(applyPurchaseRequirements);

export type VtuWalletOnlyChargeInput = z.infer<
  typeof vtuWalletOnlyChargeSchema
>;
