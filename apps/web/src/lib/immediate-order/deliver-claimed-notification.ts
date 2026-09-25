import type { ReceiptOrder } from '@baci/shared';
import { logger } from '@/lib/logger';
import { sendImmediateOrderConfirmationEmail } from './confirmation-email';
import { buildImmediateInvoiceArtifacts } from './invoice-artifacts';
import { completeNotificationWithProvisioningRetry } from './notification-completion-retry';
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
 * Runs the won notification claim's after() delivery: marks the claim
 * started, builds method-specific artifacts, sends the confirmation
 * email, and records the terminal outcome through the provisioning
 * retry (completion silently no-ops while the HMAC secret is
 * unprovisioned, so the outcome is re-attempted until observably
 * recorded). Any failure completes failed (releasable) so a replay
 * resumes instead of the shopper receiving a partial message marked
 * delivered. Never rejects: errors are completed + logged. Extracted
 * from the orders POST route (Boy Scout rule).
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
  try {
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
      claimToken
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
    // claim. The retry re-attempts until the terminal status is
    // observably recorded (completion no-ops while the HMAC
    // secret is unprovisioned).
    await completeNotificationWithProvisioningRetry(
      notificationCtx.supabase,
      orderId,
      notificationCtx.trackingToken,
      true,
      claimToken
    );
  } catch (emailError) {
    await completeNotificationWithProvisioningRetry(
      notificationCtx.supabase,
      orderId,
      notificationCtx.trackingToken,
      false,
      claimToken
    );
    logger.error({
      message: 'Error sending order confirmation email',
      error: emailError,
    });
  }
}
