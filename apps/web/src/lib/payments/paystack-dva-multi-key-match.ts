// Phase B — B0 tightened DVA match key (Δ-3, Δ-6, Δ-55, Δ-57).
//
// Pure function: given a list of `order_payment_accounts` candidates
// joined with their orders, plus the verified Paystack webhook context
// (amount, customer email, paid_at), return either a single match, an
// ambiguous multi-match, or no match.
//
// The upstream lookup already filters by `(provider='paystack',
// account_number=<receiver>)` so we only see candidates that share the
// account number. This function applies the remaining B0 predicates:
// amount, customer_email, and the paid_at lower bound. The short checkout
// window remains the preferred discriminator when several reusable-DVA
// aliases exist. If no candidate is inside that window, an exact unique late
// match is accepted; multiple late matches remain ambiguous for review.
//
//   paid_at IN [assignment timestamp,
//               account_expires_at when present, else assignment + 90 min]
//
// Lower bound = DVA assignment time (we don't accept payments
// predating the DVA — defensive against ref-replay).
// Upper bound respects the persisted expires_at when returned. If no expiry
// was stored, use `created_at + 1h DVA countdown + 30min inter-bank settlement
// grace` = 90 minutes total.

const KOBO_TOLERANCE = 1; // ±₦0.01
const NINETY_MINUTES_MS = 90 * 60 * 1000;

export type DvaMatchCandidate = {
  order_id: string;
  merchant_id: string;
  customer_email: string | null;
  // Order total expressed in kobo to match Paystack precision.
  total_kobo: number;
  // Residual amount after wallet/savings credits, when persisted.
  payable_amount_kobo?: number | null;
  // Current collectible balance. Candidate normalization preserves the
  // assignment snapshot for merchant-created invoices while capping
  // storefront orders at their current order remainder.
  outstanding_amount_kobo?: number | null;
  // Only merchant-created invoices may infer an underpayment as intentional.
  merchant_created?: boolean;
  payment_status?: 'pending' | 'unpaid' | 'partially_paid';
  account_created_at: Date;
  account_assigned_at?: Date | null;
  account_expires_at: Date | null;
};

export type DvaMatchContext = {
  // Verified Paystack amount in kobo (data.amount from /transaction/verify).
  verifiedAmountKobo: number;
  // Paystack customer email (data.customer.email from verify).
  customerEmail: string;
  // Verified `data.paid_at` from Paystack.
  paidAt: Date;
};

export type DvaMatchResult =
  | {
      kind: 'single';
      candidate: DvaMatchCandidate;
      allocation: 'exact' | 'partial';
      timing: 'in_window' | 'late';
    }
  | {
      kind: 'ambiguous';
      candidates: DvaMatchCandidate[];
      allocation: 'exact' | 'partial';
      timing: 'in_window' | 'late';
    }
  | { kind: 'none' };

export function matchPaystackDvaCandidates(
  candidates: readonly DvaMatchCandidate[],
  context: DvaMatchContext
): DvaMatchResult {
  const normalizedContextEmail = normalizeEmail(context.customerEmail);
  const paidAtMs = context.paidAt.getTime();

  const identityMatches = candidates.filter((candidate) => {
    if (normalizeEmail(candidate.customer_email) !== normalizedContextEmail) {
      return false;
    }
    const assignedAt =
      candidate.account_assigned_at ?? candidate.account_created_at;
    const assignedAtMs = assignedAt.getTime();
    if (paidAtMs < assignedAtMs) {
      return false;
    }
    return true;
  });

  const applicableMatches = selectApplicableCandidatePerOrder(identityMatches);

  const exactMatches = applicableMatches.filter(
    (candidate) =>
      Math.abs(expectedAmountKobo(candidate) - context.verifiedAmountKobo) <=
      KOBO_TOLERANCE
  );
  const partialMatches = applicableMatches.filter((candidate) => {
    const expected = expectedAmountKobo(candidate);
    return (
      candidate.merchant_created === true &&
      context.verifiedAmountKobo > 0 &&
      context.verifiedAmountKobo < expected - KOBO_TOLERANCE
    );
  });

  const exactInWindow = exactMatches.filter((candidate) =>
    isInsideProtectedWindow(candidate, paidAtMs)
  );
  if (exactInWindow.length > 0) {
    return resultFor(exactInWindow, 'exact', 'in_window');
  }

  // A verified exact amount is stronger evidence than recency. Reused DVAs
  // can leave an older order outside the protected window while a newer
  // merchant invoice is eligible for a partial allocation. Prefer the exact
  // candidate so the newer invoice cannot absorb the older order's transfer.
  if (exactMatches.length > 0) {
    return resultFor(exactMatches, 'exact', 'late');
  }

  const partialInWindow = partialMatches.filter((candidate) =>
    isInsideProtectedWindow(candidate, paidAtMs)
  );
  if (partialInWindow.length > 0) {
    return resultFor(partialInWindow, 'partial', 'in_window');
  }

  return { kind: 'none' };
}

function selectApplicableCandidatePerOrder(
  candidates: readonly DvaMatchCandidate[]
): DvaMatchCandidate[] {
  const latestByOrder = new Map<string, DvaMatchCandidate>();

  for (const candidate of candidates) {
    const current = latestByOrder.get(candidate.order_id);
    if (!current || isNewerCandidate(candidate, current)) {
      latestByOrder.set(candidate.order_id, candidate);
    }
  }

  return [...latestByOrder.values()];
}

function isNewerCandidate(
  candidate: DvaMatchCandidate,
  current: DvaMatchCandidate
): boolean {
  const candidateAssignedAt = (
    candidate.account_assigned_at ?? candidate.account_created_at
  ).getTime();
  const currentAssignedAt = (
    current.account_assigned_at ?? current.account_created_at
  ).getTime();
  if (candidateAssignedAt !== currentAssignedAt) {
    return candidateAssignedAt > currentAssignedAt;
  }

  return (
    candidate.account_created_at.getTime() >
    current.account_created_at.getTime()
  );
}

function expectedAmountKobo(candidate: DvaMatchCandidate): number {
  return (
    candidate.outstanding_amount_kobo ??
    candidate.payable_amount_kobo ??
    candidate.total_kobo
  );
}

function isInsideProtectedWindow(
  candidate: DvaMatchCandidate,
  paidAtMs: number
): boolean {
  const assignedAt =
    candidate.account_assigned_at ?? candidate.account_created_at;
  const upperBoundFromGrace = assignedAt.getTime() + NINETY_MINUTES_MS;
  const upperBound = candidate.account_expires_at
    ? candidate.account_expires_at.getTime()
    : upperBoundFromGrace;
  return paidAtMs <= upperBound;
}

function resultFor(
  matched: DvaMatchCandidate[],
  allocation: 'exact' | 'partial',
  timing: 'in_window' | 'late'
): DvaMatchResult {
  if (matched.length === 1) {
    return { allocation, candidate: matched[0], kind: 'single', timing };
  }
  return { allocation, candidates: matched, kind: 'ambiguous', timing };
}

function normalizeEmail(value: string | null): string {
  return (value ?? '').trim().toLowerCase();
}
