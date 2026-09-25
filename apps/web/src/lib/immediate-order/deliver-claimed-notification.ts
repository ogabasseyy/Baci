import type { ReceiptOrder } from '@baci/shared';
import { logger } from '@/lib/logger';
import { sendImmediateOrderConfirmationEmail } from './confirmation-email';
import { buildImmediateInvoiceArtifacts } from './invoice-artifacts';
import { completeImmediateOrderNotificationWithProof } from './notification-claim';
import { probeImmediateNotificationCompletionProvisioned } from './notification-completion-probe';
import type {
  ImmediateOrderNotificationContext,
  PreResponsePayformeProvisioning,
} from './notification-context';
import { markImmediateOrderNotificationStartedWithProof } from './notification-start-marker';
import { provisionPayformeRetryDva } from './payforme-dva';

export interface ClaimedNotificationDelivery {
  notificationCtx: ImmediateOrderNotificationContext;
  orderId: string;
  effectivePaymentMethod: string;
  /** Lease minted by the pre-response winning claim. */
  claimToken: string | null;
  preResponsePayforme: PreResponsePayformeProvisioning;
}

/**
 * Runs the won notification claim's after() delivery: gates the send on
 * completion provisioning, marks the claim started, builds
 * method-specific artifacts, sends the confirmation email, and records
 * the terminal outcome. Any failure completes failed (releasable) so a
 * replay resumes instead of the shopper receiving a partial message
 * marked delivered. Never rejects: errors are completed + logged.
 * Extracted from the orders POST route (Boy Scout rule).
 */
export async function deliverClaimedImmediateOrderNotification(
  input: ClaimedNotificationDelivery
): Promise<void> {
  const {
    notificationCtx,
    orderId,
    effectivePaymentMethod,
    claimToken,
    preResponsePayforme,
  } = input;
  // Hoisted for the catch: a mid-send failure completes
  // failed on the probe's fresh lease (never null here —
  // an unprovisioned probe returns before any throw — but
  // the completion helper no-ops null leases regardless).
  let deliveryClaimToken: string | null = null;
  try {
    // Gate the send on completion provisioning: when the
    // HMAC secret is not yet provisioned, completion
    // silently no-ops — sending first would leave a
    // delivered email stuck in processing (or duplicated by
    // a later reclaim). The probe re-wins our own claim with
    // a fresh lease when provisioned; otherwise it returns
    // unprovisioned and this attempt sends nothing — the
    // never-started claim expires on its short grace and a
    // replay resumes delivery after provisioning.
    const provisionProbe =
      await probeImmediateNotificationCompletionProvisioned(
        notificationCtx.supabase,
        orderId,
        notificationCtx.trackingToken,
        claimToken
      );
    if (!provisionProbe.provisioned || !provisionProbe.claimToken) {
      return;
    }
    deliveryClaimToken = provisionProbe.claimToken;
    // Mark the won claim started (extends it to the full
    // 5-minute crash window): fire-and-forget first step so
    // the marker lands while artifacts build, without
    // delaying the send. Never rejects (a marker failure
    // keeps the short never-started grace, and completion
    // stays lease-fenced either way).
    void markImmediateOrderNotificationStartedWithProof(
      notificationCtx.supabase,
      orderId,
      notificationCtx.trackingToken,
      deliveryClaimToken
    );
    let invoiceVirtualAccount: ReceiptOrder['virtual_account'] = null;
    let attachments:
      | Array<{ name: string; content: string; mime_type: string }>
      | undefined;
    if (effectivePaymentMethod === 'invoice') {
      // Invoice-only artifacts (persisted items, DVA, PDF,
      // reminders); a failure rejects so the claim completes
      // failed and a replay retries instead of sending an
      // attachment-less message marked sent.
      ({ attachments, invoiceVirtualAccount } =
        await buildImmediateInvoiceArtifacts(notificationCtx));
    }
    if (effectivePaymentMethod === 'payforme') {
      // Pay for Me skips the invoice-only artifacts above and
      // provisions through the proof-bound reservation RPC —
      // never the service-role client (AGENTS.md).
      const retryVirtualAccount = await provisionPayformeRetryDva(
        notificationCtx,
        preResponsePayforme
      );
      if (retryVirtualAccount) {
        invoiceVirtualAccount = retryVirtualAccount;
      }
    }
    // Rendered here (not with emailData above) so the proforma
    // body carries the provisioned DVA as bank-transfer payment
    // instructions — the tracking link shows status only and
    // cannot take payment.
    await sendImmediateOrderConfirmationEmail(notificationCtx, {
      attachments,
      invoiceVirtualAccount,
    });
    // Sent is terminal: replays observe it and skip. Failed
    // releases the claim so the next replay resumes delivery.
    // The lease token (minted by our winning claim) fences
    // completion to this attempt: a stale worker that outlives
    // the reclaim window cannot complete the replacement's
    // claim.
    await completeImmediateOrderNotificationWithProof(
      notificationCtx.supabase,
      orderId,
      notificationCtx.trackingToken,
      true,
      deliveryClaimToken
    );
  } catch (emailError) {
    await completeImmediateOrderNotificationWithProof(
      notificationCtx.supabase,
      orderId,
      notificationCtx.trackingToken,
      false,
      deliveryClaimToken
    );
    logger.error({
      message: 'Error sending order confirmation email',
      error: emailError,
    });
  }
}
