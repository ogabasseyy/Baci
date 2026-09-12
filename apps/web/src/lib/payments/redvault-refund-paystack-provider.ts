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

export function createRedvaultPaystackRefundProvider({
  fetcher = fetch,
  getSecret,
}: {
  fetcher?: typeof fetch;
  getSecret: () => string | undefined;
}): RedvaultRefundProvider & RedvaultRefundReconciliationProvider {
  async function request(path: string, body?: Record<string, unknown>) {
    try {
      const secret = getSecret();
      if (!secret) return null;
      const response = await fetcher(`https://api.paystack.co/refund${path}`, {
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
      return envelope?.status === true ? record(envelope.data) : null;
    } catch {
      return null;
    }
  }
  return {
    async submit({ amountKobo, originalCaptureReference }) {
      if (
        !Number.isSafeInteger(amountKobo) ||
        amountKobo <= 0 ||
        !/^[A-Za-z0-9.=_-]{1,100}$/.test(originalCaptureReference)
      )
        return { kind: 'indeterminate' };
      const data = await request('', {
        transaction: originalCaptureReference,
        amount: amountKobo,
        currency: 'NGN',
      });
      const providerReference = refundId(data?.id);
      if (
        !data ||
        !providerReference ||
        record(data.transaction)?.reference !== originalCaptureReference ||
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
    async lookup({ providerReference }) {
      if (!/^[1-9][0-9]*$/.test(providerReference))
        throw new Error('REDVAULT refund lookup invalid identifier');
      const data = await request(`/${providerReference}`);
      if (!data || refundId(data.id) !== providerReference)
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
