import { fetchWithCsrf } from '@/lib/api-client';

export interface ImeiRemediationOffer {
  carrier: string;
  id: string;
  name: string;
  priceNgn: number;
  priceUsdt: number;
  refundPolicy: 'no_refund_denial' | 'refundable';
  successRate: number | null;
  turnaround: string | null;
}

export interface ImeiRemediationOrder {
  amountNgn: number | null;
  amountUsdt: number | null;
  carrier: string | null;
  completedAt: string | null;
  createdAt: string;
  customerMessage: string | null;
  deviceModel: string | null;
  id: string;
  paymentCurrency: 'NGN' | 'USDT' | null;
  refundPolicy: 'no_refund_denial' | 'refundable' | null;
  status: string;
  successRate: number | null;
  turnaround: string | null;
  updatedAt: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function offer(value: unknown): ImeiRemediationOffer | null {
  const data = record(value);
  if (
    !data ||
    typeof data.id !== 'string' ||
    typeof data.carrier !== 'string' ||
    typeof data.name !== 'string' ||
    typeof data.priceNgn !== 'number' ||
    typeof data.priceUsdt !== 'number' ||
    (data.refundPolicy !== 'refundable' &&
      data.refundPolicy !== 'no_refund_denial')
  ) {
    return null;
  }
  return {
    carrier: data.carrier,
    id: data.id,
    name: data.name,
    priceNgn: data.priceNgn,
    priceUsdt: data.priceUsdt,
    refundPolicy: data.refundPolicy,
    successRate: typeof data.successRate === 'number' ? data.successRate : null,
    turnaround: typeof data.turnaround === 'string' ? data.turnaround : null,
  };
}

async function eligibility(input: {
  identifier: string;
  lookupId: string;
  merchantSlug: string;
}) {
  try {
    const response = await fetchWithCsrf(
      '/api/storefront/imei-remediation/eligibility',
      {
        body: JSON.stringify(input),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      }
    );
    const data = record(await response.json());
    if (response.status === 404) return { kind: 'hidden' as const };
    if (response.status === 202 && data?.status === 'eligibility_pending') {
      return {
        assessmentId:
          typeof data.assessmentId === 'string' ? data.assessmentId : null,
        kind: 'pending' as const,
        pollAfterMs:
          typeof data.pollAfterMs === 'number' ? data.pollAfterMs : 5_000,
      };
    }
    if (response.ok && data?.status === 'suppressed') {
      return { kind: 'suppressed' as const };
    }
    if (
      response.ok &&
      data?.status === 'eligible' &&
      typeof data.assessmentId === 'string' &&
      Array.isArray(data.offers)
    ) {
      const offers = data.offers
        .map((candidate) => offer(candidate))
        .filter((candidate): candidate is ImeiRemediationOffer =>
          Boolean(candidate)
        );
      return offers.length > 0
        ? {
            assessmentId: data.assessmentId,
            kind: 'eligible' as const,
            offers,
            usdtEnabled: data.usdtEnabled === true,
          }
        : { kind: 'suppressed' as const };
    }
    return {
      error:
        typeof data?.error === 'string'
          ? data.error
          : 'Unable to check unlock availability.',
      kind: 'error' as const,
    };
  } catch {
    return {
      error: 'Unable to check unlock availability.',
      kind: 'error' as const,
    };
  }
}

async function place(input: {
  identifier: string;
  merchantSlug: string;
  orderId: string;
  paymentCurrency: 'NGN' | 'USDT';
  productId: string;
}) {
  try {
    const response = await fetchWithCsrf(
      '/api/storefront/imei-remediation/orders',
      {
        body: JSON.stringify(input),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      }
    );
    const data = record(await response.json());
    if (response.ok && typeof data?.status === 'string') {
      return {
        kind:
          response.status === 202
            ? ('pending' as const)
            : ('terminal' as const),
        orderId:
          typeof data.orderId === 'string' ? data.orderId : input.orderId,
        status: data.status,
      };
    }
    return {
      code: typeof data?.code === 'string' ? data.code : 'ORDER_FAILED',
      error:
        typeof data?.error === 'string'
          ? data.error
          : 'Unable to place unlock order.',
      kind: 'error' as const,
      status: response.status,
    };
  } catch {
    return {
      error: 'Unable to place unlock order.',
      kind: 'error' as const,
      status: 0,
    };
  }
}

async function list(
  merchantSlug: string,
  signal?: AbortSignal
): Promise<ImeiRemediationOrder[]> {
  const response = await fetchWithCsrf(
    `/api/storefront/imei-remediation/orders?merchantSlug=${encodeURIComponent(merchantSlug)}`,
    { method: 'GET', signal }
  );
  const data = record(await response.json());
  return response.ok && Array.isArray(data?.orders)
    ? (data.orders as ImeiRemediationOrder[])
    : [];
}

export const imeiRemediationApi = { eligibility, list, place };
