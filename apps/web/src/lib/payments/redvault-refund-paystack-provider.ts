import 'server-only';
import type {
  RedvaultRefundProvider,
  RedvaultRefundReconciliationProvider,
} from './redvault-refund-orchestrator';

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function refundId(value: unknown): string | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? String(value)
    : null;
}

// Clock-skew allowance when correlating a provider record's creation time
// against the local submission: NTP drift between hosts is bounded well
// below this, while an earlier sibling submission is older by at least a
// full worker cycle.
const SUBMISSION_SKEW_TOLERANCE_MS = 5 * 60 * 1_000;

export function createRedvaultPaystackRefundProvider({
  fetcher = fetch,
  getSecret,
}: {
  fetcher?: typeof fetch;
  getSecret: () => string | undefined;
}): RedvaultRefundProvider & RedvaultRefundReconciliationProvider {
  async function request(path: string, body?: Record<string, unknown>) {
    const envelope = await requestEnvelope('/refund', path, body);
    return envelope?.status === true ? record(envelope.data) : null;
  }
  async function requestEnvelope(
    base: string,
    path: string,
    body?: Record<string, unknown>
  ) {
    try {
      const secret = getSecret();
      if (!secret) return null;
      const response = await fetcher(`https://api.paystack.co${base}${path}`, {
        method: body ? 'POST' : 'GET',
        headers: {
          Authorization: `Bearer ${secret}`,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) return null;
      const envelope = record(await response.json());
      return envelope?.status === true ? envelope : null;
    } catch {
      return null;
    }
  }
  async function requestList(path: string) {
    const envelope = await requestEnvelope('/refund', path);
    const data = envelope?.data;
    return Array.isArray(data) ? data : null;
  }
  // Live refund payloads identify `transaction` with the provider
  // transaction ID (a number), not an expanded reference object. Resolve a
  // numeric ID to its reference through the documented fetch-transaction
  // endpoint so valid submissions stay bound to the original capture.
  async function resolveTransactionReference(
    value: unknown
  ): Promise<string | null> {
    if (typeof value === 'string') return value;
    const expanded = record(value);
    if (expanded && typeof expanded.reference === 'string') {
      return expanded.reference;
    }
    if (
      typeof value !== 'number' ||
      !Number.isSafeInteger(value) ||
      value <= 0
    ) {
      return null;
    }
    const envelope = await requestEnvelope('/transaction', `/${value}`);
    if (envelope?.status !== true) return null;
    const reference = record(envelope.data)?.reference;
    return typeof reference === 'string' ? reference : null;
  }
  return {
    async submit({ amountKobo, originalCaptureReference, correlationKey }) {
      if (
        !Number.isSafeInteger(amountKobo) ||
        amountKobo <= 0 ||
        !/^[A-Za-z0-9.=_-]{1,100}$/.test(originalCaptureReference) ||
        typeof correlationKey !== 'string' ||
        correlationKey.length < 1 ||
        correlationKey.length > 100
      )
        return { kind: 'indeterminate' };
      // Echo the durable local refund identity on the provider record so a
      // lost submit response stays correlatable: lookup matches this note
      // instead of trusting amount and timing alone.
      const data = await request('', {
        transaction: originalCaptureReference,
        amount: amountKobo,
        currency: 'NGN',
        merchant_note: correlationKey,
      });
      const providerReference = refundId(data?.id);
      const transactionReference = data
        ? await resolveTransactionReference(data.transaction)
        : null;
      if (
        !data ||
        !providerReference ||
        transactionReference !== originalCaptureReference ||
        data.amount !== amountKobo ||
        data.currency !== 'NGN'
      )
        return { kind: 'indeterminate' };
      if (data.status === 'processed')
        return {
          kind: 'processed',
          providerReference,
          providerStatus: 'processed',
        };
      return {
        kind: 'accepted_pending',
        providerReference,
        providerStatus: [
          'pending',
          'processing',
          'needs-attention',
          'failed',
        ].includes(String(data.status))
          ? String(data.status)
          : 'unknown',
      };
    },
    async lookup({
      providerReference,
      expectedAmountKobo,
      expectedCaptureReference,
      expectedCurrency,
    }) {
      if (!/^[1-9][0-9]*$/.test(providerReference))
        throw new Error('REDVAULT refund lookup invalid identifier');
      const data = await request(`/${providerReference}`);
      const transactionReference = data
        ? await resolveTransactionReference(data.transaction)
        : null;
      if (
        !data ||
        refundId(data.id) !== providerReference ||
        transactionReference !== expectedCaptureReference ||
        data.amount !== expectedAmountKobo ||
        data.currency !== expectedCurrency
      )
        throw new Error('REDVAULT refund lookup unverified');
      if (data.status === 'processed' || data.status === 'failed')
        return { kind: data.status, providerStatus: data.status };
      if (
        data.status === 'pending' ||
        data.status === 'processing' ||
        data.status === 'needs-attention'
      ) {
        return { kind: 'pending', providerStatus: 'pending' };
      }
      throw new Error('REDVAULT refund lookup unknown status');
    },
    async lookupByCaptureReference({
      captureReference,
      expectedAmountKobo,
      expectedCurrency,
      expectedCorrelationKey,
      knownProviderReferences,
      submittedAt,
    }) {
      // Reference-less indeterminate submissions have no numeric refund ID
      // for the fetch-refund endpoint. List refunds for the original capture
      // reference instead (Paystack supports filtering the list by
      // transaction), then match client-side. Only a unique NEW provider
      // record carrying this refund's echoed correlation key resolves
      // terminally: timing and amount alone cannot establish identity (an
      // untracked manual same-amount refund in the window would match), so
      // anything without the key stays pending for operator review.
      if (!/^[A-Za-z0-9.=_-]{1,100}$/.test(captureReference))
        throw new Error('REDVAULT refund lookup invalid identifier');
      if (
        typeof expectedCorrelationKey !== 'string' ||
        expectedCorrelationKey.length < 1
      )
        return { kind: 'pending', providerStatus: 'pending' };
      const known = new Set(
        (knownProviderReferences ?? []).filter(
          (reference): reference is string =>
            typeof reference === 'string' && reference.length > 0
        )
      );
      const submittedMs =
        typeof submittedAt === 'string' ? Date.parse(submittedAt) : Number.NaN;
      const rows = await requestList(
        `?transaction=${encodeURIComponent(captureReference)}&perPage=100`
      );
      const matches: { providerReference: string; status: string }[] = [];
      for (const row of rows ?? []) {
        const candidate = record(row);
        if (!candidate) continue;
        // Amount and currency filter first so the transaction-ID lookup
        // below only fires for plausible rows.
        if (
          candidate.amount !== expectedAmountKobo ||
          candidate.currency !== expectedCurrency
        )
          continue;
        const candidateReference = await resolveTransactionReference(
          candidate.transaction
        );
        if (candidateReference !== captureReference) continue;
        const providerReference = refundId(candidate.id);
        if (!providerReference || known.has(providerReference)) continue;
        if (Number.isFinite(submittedMs)) {
          const createdMs = Date.parse(String(candidate.createdAt ?? ''));
          if (
            !Number.isFinite(createdMs) ||
            createdMs < submittedMs - SUBMISSION_SKEW_TOLERANCE_MS
          )
            continue;
        }
        // Identity, not timing: only the record carrying this refund's
        // echoed correlation key can be this submission. The list shape may
        // omit notes, so resolve a missing note through the fetch-refund
        // endpoint (same per-candidate pattern as the transaction lookup).
        let merchantNote =
          typeof candidate.merchant_note === 'string'
            ? candidate.merchant_note
            : null;
        if (merchantNote === null) {
          const fetched = await request(`/${providerReference}`);
          merchantNote =
            typeof fetched?.merchant_note === 'string'
              ? fetched.merchant_note
              : null;
        }
        if (merchantNote !== expectedCorrelationKey) continue;
        matches.push({ providerReference, status: String(candidate.status) });
      }
      if (matches.length !== 1) {
        return { kind: 'pending', providerStatus: 'pending' };
      }
      const match = matches[0];
      if (match.status === 'processed' || match.status === 'failed')
        return {
          kind: match.status,
          providerReference: match.providerReference,
          providerStatus: match.status,
        };
      if (
        match.status === 'pending' ||
        match.status === 'processing' ||
        match.status === 'needs-attention'
      ) {
        return { kind: 'pending', providerStatus: 'pending' };
      }
      throw new Error('REDVAULT refund lookup unknown status');
    },
  };
}

export function createTestRedvaultPaystackRefundProvider({
  fetcher,
  providerKey,
}: {
  fetcher?: typeof fetch;
  providerKey: string;
}): RedvaultRefundProvider & RedvaultRefundReconciliationProvider {
  if (!/^sk_test_[A-Za-z0-9_-]+$/.test(providerKey)) {
    throw new Error('REDVAULT refund recovery requires a Paystack test key');
  }
  return createRedvaultPaystackRefundProvider({
    fetcher,
    getSecret: () => providerKey,
  });
}
