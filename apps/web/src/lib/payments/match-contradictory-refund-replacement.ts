import { normalizeCurrencyCode } from './normalize-currency-code';
import { normalizePaymentGateway } from './normalize-payment-gateway';

export interface FailedRefundRow {
  amount: number | string | null;
  created_at: string;
  currency: string | null;
  gateway: string | null;
  gateway_reference: string | null;
  id: string;
  metadata: { method?: unknown; payment_transaction_id?: unknown } | null;
}

/**
 * Effective gateway for replacement matching: a manual row claiming
 * Paystack money is Paystack in substance whatever its stored
 * gateway label, on both the failed and the replacement side. Without
 * this a failed stamped manual could never match a later native
 * provider refund on the same leg, filing a false contradiction for a
 * completed replacement.
 */
function effectiveRefundGateway(
  gateway: string | null,
  metadata: { method?: unknown } | null
): string {
  const stored = normalizePaymentGateway(gateway);
  if (stored !== 'MANUAL') {
    return stored;
  }
  const method = metadata?.method;
  return typeof method === 'string' &&
    method.trim().toLowerCase() === 'paystack'
    ? 'PAYSTACK'
    : stored;
}

export interface ReplacementRefundRow {
  amount: number | string | null;
  created_at: string;
  currency: string | null;
  gateway: string | null;
  id: string;
  // The resolver filters both terminal statuses in code; the matcher
  // itself never sees a non-terminal row.
  status: string;
  metadata: {
    method?: unknown;
    payment_transaction_id?: unknown;
    provider_refund_status?: unknown;
  } | null;
}

/**
 * A replacement suppresses a failed leg only when it both targets that
 * same leg (identical payment leg, gateway, and currency) and was
 * created after the failure itself. Timing is per leg, not per the
 * shared notification row: a later failure on another leg resets the
 * notification's timestamp, which would otherwise exclude an earlier
 * leg's valid replacement and alert falsely. A Paystack replacement
 * counts only after provider verification, mirroring the completion
 * ledger: a locally completed row Paystack later rejects must not
 * suppress the alert. Manual Paystack claims need the same proof: a
 * newer unattested merchant claim for provider money is not
 * coverage, or a failed stamped manual would be silently superseded
 * by a claim the provider never confirmed. Anything unmatchable or
 * unparseable fails closed so the contradiction is filed and alerted.
 */
function replacementMatchesFailedLeg(
  replacement: ReplacementRefundRow,
  failed: FailedRefundRow
): boolean {
  const failedLeg = failed.metadata?.payment_transaction_id;
  if (typeof failedLeg !== 'string' || failedLeg.length === 0) return false;
  if (replacement.metadata?.payment_transaction_id !== failedLeg) return false;
  // Effective gateways on both sides: a manual row claiming Paystack
  // money matches native Paystack rows (either direction), so a failed
  // stamped manual meets its later provider-verified native
  // replacement instead of filing a false contradiction. Trimmed and
  // case-folded throughout, so a padded spelling cannot match as the
  // same transfer while dodging Paystack classification.
  const replacementGateway = effectiveRefundGateway(
    replacement.gateway,
    replacement.metadata
  );
  const failedGateway = effectiveRefundGateway(failed.gateway, failed.metadata);
  if (
    replacementGateway === '' ||
    failedGateway === '' ||
    replacementGateway !== failedGateway
  ) {
    return false;
  }
  if (
    typeof replacement.currency !== 'string' ||
    typeof failed.currency !== 'string' ||
    normalizeCurrencyCode(replacement.currency) !==
      normalizeCurrencyCode(failed.currency)
  ) {
    return false;
  }
  // A locally completed Paystack replacement counts only after it is
  // provider-verified; other gateways keep local-status trust.
  if (
    replacementGateway === 'PAYSTACK' &&
    replacement.metadata?.provider_refund_status !== 'processed'
  ) {
    return false;
  }
  const replacedAt = Date.parse(replacement.created_at);
  const failedAt = Date.parse(failed.created_at);
  if (!Number.isFinite(replacedAt) || !Number.isFinite(failedAt)) {
    return false;
  }
  return replacedAt > failedAt;
}

/**
 * Every failed row is covered only when the matching postdating
 * replacements allocated to it sum to at least its amount — and each
 * replacement is spent once, oldest failure first. Without allocation,
 * one 50-unit replacement postdating two failed 50-unit rows on the
 * same leg would cover each of them against the full pool while only
 * half the leg was actually refunded, suppressing a live
 * contradiction. A failed 100-unit refund replaced by two completed
 * 50-unit refunds on the same leg is fully superseded. Malformed or
 * non-positive failed amounts fail closed. No failed rows at all means
 * the queued failure
 * was superseded: the provider verdict domain is closed and only the
 * RPC records failure verdicts, so an empty scan proves every failure
 * was overwritten by a later non-failure verdict — alerting anyway
 * would file a contradiction with no failed evidence.
 */
export function allFailedLegsCoveredByReplacements(
  failedRows: FailedRefundRow[],
  replacements: ReplacementRefundRow[]
): boolean {
  if (failedRows.length === 0) return true;
  const ordered = [...failedRows].sort(
    (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)
  );
  // Spend oldest replacement first: a replacement matching only the
  // earlier failure is older than one matching both, so oldest-first
  // spending consumes the narrowest match before the shared pool. In
  // scan order a later shared replacement could be spent on the
  // earlier failure first, starving the later failure into a false
  // alert. Rows with unparseable dates sort last and never match.
  const orderedReplacements = [...replacements].sort((a, b) => {
    const aAt = Date.parse(a.created_at);
    const bAt = Date.parse(b.created_at);
    return (
      (Number.isFinite(aAt) ? aAt : Number.POSITIVE_INFINITY) -
      (Number.isFinite(bAt) ? bAt : Number.POSITIVE_INFINITY)
    );
  });
  // Replacement index to its unconsumed amount; entries materialize on
  // first match so an unrelated malformed row cannot fail the scan.
  const remaining = new Map<number, number>();
  for (const failed of ordered) {
    const failedAmount = Number(failed.amount);
    // A zero or negative failed amount is corrupt, not covered: need
    // would start non-positive and skip the replacement loop, marking
    // the shared notification sent without delivery even when no
    // replacement exists. Fail closed so the alert still sends.
    if (!Number.isFinite(failedAmount) || failedAmount <= 0) return false;
    let need = failedAmount;
    for (let i = 0; i < orderedReplacements.length && need > 0; i++) {
      const replacement = orderedReplacements[i] as ReplacementRefundRow;
      if (!replacementMatchesFailedLeg(replacement, failed)) continue;
      let left = remaining.get(i);
      if (left === undefined) {
        left = Number(replacement.amount);
        if (!Number.isFinite(left)) return false;
      }
      const take = Math.min(Math.max(left, 0), need);
      need -= take;
      remaining.set(i, left - take);
    }
    if (need > 0) return false;
  }
  return true;
}
