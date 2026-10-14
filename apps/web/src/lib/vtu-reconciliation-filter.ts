/**
 * Candidate filter for the VTU processing cron. Extracted from
 * vtu-processing-reconciliation.ts per the 300-line ceiling (Codex
 * R90 P1): the selector is pure string-building (plus a lease
 * cutoff from the invocation clock), while the cron owns paging,
 * deadlines, and orchestration.
 */
import { CUSTOMER_EMAIL_NOTIFICATION_CLAIM_LEASE_MS } from '@/lib/vtu-metadata-fields';

// Every type the wallet-only route can leave 'processing' (202): a
// customer who closes the pending screen without retrying must still
// have their transaction resolved (success or failed+refund) by the
// cron. Fulfill is the same generic resume the replay path uses, and
// the wallet RPC's source_id idempotency makes re-driving safe.
export const RECONCILABLE_VTU_TYPES = [
  'airtime',
  'data',
  'electricity',
  'cable_tv',
  'betting',
] as const;
// Processing rows requery by provider reference; marked pending rows
// re-vend instead (claim → idempotent debit → vend): Monnify timeouts
// restored to pending (requery without a vendReference is PENDING
// forever) and pre-vend interruptions (debit RPC / walletDebited
// write failures — reference-less, so the reconcile claim declines
// them). Failed rows persist BEFORE their refund is attempted, so a
// transient reversal failure would strand the debit when the customer
// closes the client instead of retrying (the 500 keeps the key, but
// only a retry re-drives it): failed+refund-required+unissued rows
// are selected so the failed branch confirms the refund. The failed
// clause mirrors requiresVtuCustomerWalletRefund in PostgREST form —
// gating on the wallet-debit marker instead would permanently exclude
// card-only rows (no marker) whose refundCardOnly failed, leaving
// history refund_pending with no background path retrying the credit.
// Plain pending rows (mapping-less orphans, PK-race leftovers) and
// already-refunded failures stay excluded. Successful rows with
// unsettled wallet credits (Codex R81 P1): a credit RPC failing
// after the vend lands leaves merchant/customerWalletCredited unset
// while clients discard the key on success — only this cron can
// retry the missing commission/cashback. Fulfill routes successful
// rows to the settle-only path (no re-vend; ledger guards skip
// landed credits), so re-driving is safe. The loyalty arm (Codex
// R85 P2) covers the sibling gap: a transient award RPC failure is
// logged, not thrown, so fulfillment returns success and clients
// discard the key while the points stay unawarded. Eligible rows
// are airtime with a linked customer and points-earning cashback
// (earned = floor(cashback/3) > 0 ⟺ cashback >= 3) lacking the
// loyaltyPointsAwarded marker; the award RPC is idempotent
// (already_awarded) and resolveSuccessful re-runs it. The email arm
// (Codex R86 P2) covers the notifier sibling: a ZeptoMail failure is
// recorded (sent=false, claim cleared) while fulfillment still
// returns success, so clients discard the key and the receipt or
// token-ready email is never retried. Only RECORDED failures match
// (`eq.false` on the receipt, token-ready, or legacy sent keys —
// never-attempted rows stay excluded); the email-claim RPC
// serializes concurrent re-drives. Receipt failures retire once the
// token email succeeds (Codex R92 P2): a tokenless bill whose
// receipt fails, then gains a PIN via backfill, switches notify to
// the token state — the token sends but the receipt Sent=false (or
// stuck marker) is never cleared, and without retirement the row
// matches forever with no work left, an ever-growing backlog. So
// the receipt/legacy-failure disjuncts (recorded AND stuck) carry a
// token-unsent gate; the token-failure disjuncts are ungated (a
// failed token is itself work). Absent flags match too, via an
// explicit null arm: `->>` extracts TEXT, and `IS NOT TRUE` on text
// is a Postgres type error that would 500 the whole cron (Codex R82
// P1) — boolean intent must be `neq.true` + `is.null` (text
// equality like `eq.false` is type-safe). The stuck-claim disjuncts
// (Codex R89 P2) cover the crash windows the recorded-failure arm
// misses: a crash between the email-claim RPC and the sent write
// leaves Attempted=true with the sent key unset (eq.false never
// matches a missing key), and a crash between the clear RPC and the
// settlement persist leaves Attempted=false with the sent key unset.
// Either row would never be retried. Stuck = sent key absent AND
// (claim cleared OR claim timestamp missing/older than the lease —
// the same lease the claim RPC and the TS pre-check enforce, so a
// live sender's fresh lease is never stolen); the cutoff is computed
// from the invocation `now`, which is why the filter is built per
// call instead of hoisted. `eq.false` on an absent attempted key is
// NULL (no match), so never-attempted rows stay excluded. The
// token-backfill arm (Codex R90 P2) covers the late-PIN sibling: a
// bill row that settles with no token sends the RECEIPT email while
// both token markers stay absent; the history backfill later writes
// the PIN directly and never notifies, and neither the
// recorded-failure arm (needs Sent=false) nor the stuck arm (needs
// an attempted state) matches NULL markers — so the token-ready
// email never fires. Eligible = token-capable type + linked
// customer + PIN present + receipt already sent (proof settle-notify
// ran AND the customer is emailable — this both excludes email-less
// rows that would churn the cron and pre-notify rows the live
// settle still owns) + both token markers unset. Receipt-failed
// rows need no special case: the R86 arm already re-drives them,
// and the re-drive notifies with the PIN in hand. Re-driving is
// safe (settle-only; the token claim serializes concurrency).
const TOKEN_BACKFILL_ARM =
  'and(or(type.eq.electricity,type.eq.cable_tv,type.eq.betting),customer_id.not.is.null,metadata->>voucherPin.not.is.null,metadata->>customerReceiptEmailNotificationSent.eq.true,metadata->>customerTokenEmailNotificationSent.is.null,metadata->>customerTokenEmailNotificationAttempted.is.null)';
function getEmailStuckClaimDisjunct({
  attemptedKey,
  attemptedAtKey,
  cutoff,
  gate,
  sentKey,
}: {
  attemptedAtKey: string;
  attemptedKey: string;
  cutoff: string;
  gate?: string;
  sentKey: string;
}) {
  const stuck = `metadata->>${sentKey}.is.null,or(metadata->>${attemptedKey}.eq.false,and(metadata->>${attemptedKey}.eq.true,or(metadata->>${attemptedAtKey}.is.null,metadata->>${attemptedAtKey}.lt.${cutoff})))`;
  return gate ? `and(${stuck},${gate})` : `and(${stuck})`;
}

// Token-unsent gate for receipt-failure retirement (Codex R92 P2):
// the token key is TEXT via `->>`, so unsent is `is.null` OR
// `neq.true` (R82: never `is not true`). Matches unset AND
// explicitly-failed tokens; only `true` retires the row.
const TOKEN_UNSENT_GATE =
  'or(metadata->>customerTokenEmailNotificationSent.is.null,metadata->>customerTokenEmailNotificationSent.neq.true)';

export function getReconciliableStatusFilter(now: Date) {
  const cutoff = new Date(
    now.getTime() - CUSTOMER_EMAIL_NOTIFICATION_CLAIM_LEASE_MS
  ).toISOString();
  const stuckReceiptClaim = getEmailStuckClaimDisjunct({
    attemptedAtKey: 'customerReceiptEmailNotificationAttemptedAt',
    attemptedKey: 'customerReceiptEmailNotificationAttempted',
    cutoff,
    gate: TOKEN_UNSENT_GATE,
    sentKey: 'customerReceiptEmailNotificationSent',
  });
  const stuckTokenClaim = getEmailStuckClaimDisjunct({
    attemptedAtKey: 'customerTokenEmailNotificationAttemptedAt',
    attemptedKey: 'customerTokenEmailNotificationAttempted',
    cutoff,
    sentKey: 'customerTokenEmailNotificationSent',
  });
  const retiredReceiptFailure = `and(metadata->>customerReceiptEmailNotificationSent.eq.false,${TOKEN_UNSENT_GATE})`;
  const retiredLegacyFailure = `and(metadata->>customerEmailNotificationSent.eq.false,${TOKEN_UNSENT_GATE})`;
  return `status.eq.processing,and(status.eq.pending,or(metadata->>monnifyTransientVendError.not.is.null,metadata->>preVendInterruptedAt.not.is.null)),and(status.eq.failed,source.eq.checkout,amount.gt.0,customer_id.not.is.null,metadata->>refundIssued.is.null,metadata->>refundSkipped.is.null),and(status.eq.successful,or(and(merchant_commission.gt.0,or(metadata->>merchantWalletCredited.neq.true,metadata->>merchantWalletCredited.is.null)),and(customer_cashback.gt.0,customer_id.not.is.null,or(metadata->>customerWalletCredited.neq.true,metadata->>customerWalletCredited.is.null)),and(type.eq.airtime,customer_id.not.is.null,customer_cashback.gte.3,or(metadata->>loyaltyPointsAwarded.neq.true,metadata->>loyaltyPointsAwarded.is.null)),${TOKEN_BACKFILL_ARM},and(customer_id.not.is.null,or(${retiredReceiptFailure},metadata->>customerTokenEmailNotificationSent.eq.false,${retiredLegacyFailure},${stuckReceiptClaim},${stuckTokenClaim}))))`;
}
