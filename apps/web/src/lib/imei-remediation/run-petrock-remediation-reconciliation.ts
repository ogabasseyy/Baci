import 'server-only';

import { randomUUID } from 'node:crypto';
import { decryptImeiIdentifier } from '@/lib/imei-identifier-crypto';
import type { createPetrockClient } from '@/lib/imei-providers/petrock/petrock-client';
import type { createAdminClient } from '@/lib/supabase/admin';
import { recoverPaidPetrockRemediationOrder } from './petrock-remediation-paid-recovery';
import {
  claimPetrockRemediationOrders,
  createPetrockRemediationReconcileState,
  readApprovedPetrockRemediationProducts,
} from './petrock-remediation-reconcile-state';
import { reconcilePetrockRemediationOrder } from './petrock-remediation-reconciler';
import { readPetrockHouseCheckProduct } from './petrock-remediation-state';

export async function runPetrockRemediationReconciliation({
  client,
  encryptionKey,
  origin,
  supabaseAdmin,
}: {
  client: ReturnType<typeof createPetrockClient>;
  encryptionKey: string;
  origin: string;
  supabaseAdmin: ReturnType<typeof createAdminClient>;
}) {
  const claimed = await claimPetrockRemediationOrders({
    leaseToken: randomUUID(),
    supabaseAdmin,
  });
  const state = createPetrockRemediationReconcileState(supabaseAdmin);
  const products = readApprovedPetrockRemediationProducts(supabaseAdmin);
  const summary = {
    claimed: claimed.length,
    completed: 0,
    eligibilityAdvanced: 0,
    errored: 0,
    failed: 0,
    manualReview: 0,
    pending: 0,
    submissionUnknown: 0,
  };

  for (const order of claimed) {
    try {
      const result = await reconcilePetrockRemediationOrder({
        client,
        decryptIdentifier: (ciphertext) =>
          decryptImeiIdentifier(ciphertext, encryptionKey),
        loadProducts: () => products,
        order,
        origin,
        readProduct: (productId) =>
          readPetrockHouseCheckProduct(supabaseAdmin, productId),
        recoverPaidOrder: (paidOrder) =>
          recoverPaidPetrockRemediationOrder({
            client,
            encryptionKey,
            order: paidOrder,
            origin,
            supabaseAdmin,
          }),
        state,
      });
      if (result.kind === 'completed') summary.completed += 1;
      else if (result.kind === 'eligibility_advanced') {
        summary.eligibilityAdvanced += 1;
      } else if (result.kind === 'submission_unknown') {
        summary.submissionUnknown += 1;
        if ('needsReview' in result && result.needsReview)
          summary.manualReview += 1;
      } else if (result.kind === 'failed' || result.kind === 'suppressed') {
        summary.failed += 1;
      } else summary.pending += 1;
    } catch (error) {
      summary.errored += 1;
      console.error('[Petrock Remediation] Reconciliation failed', {
        error,
        orderId: order.id,
      });
    }
  }
  return summary;
}
