import { fetchWithCsrf } from '@/lib/api-client';

interface UsdtFundingInput {
  amount: number;
  billingAddress: {
    city: string;
    country: string;
    line1: string;
    line2?: string;
    state?: string;
    zipCode: string;
  };
  chain: 'AVAXC' | 'ETH' | 'MATIC' | 'TRX';
  customerName?: string;
  customerPhone?: string;
  merchantSlug: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function initialize(input: UsdtFundingInput) {
  try {
    const response = await fetchWithCsrf(
      '/api/storefront/customer/wallet/top-up/usdt/initialize',
      {
        body: JSON.stringify(input),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      }
    );
    const data = record(await response.json());
    if (response.ok && data?.success === true) {
      return {
        amount: typeof data.amount === 'number' ? data.amount : input.amount,
        chain: typeof data.chain === 'string' ? data.chain : input.chain,
        depositAddress:
          typeof data.depositAddress === 'string' ? data.depositAddress : null,
        kind: 'ready' as const,
        reference: typeof data.reference === 'string' ? data.reference : '',
      };
    }
    return {
      error:
        typeof data?.error === 'string'
          ? data.error
          : 'Unable to create a USDT deposit address.',
      kind: 'error' as const,
    };
  } catch {
    return {
      error: 'Unable to create a USDT deposit address.',
      kind: 'error' as const,
    };
  }
}

async function status(
  reference: string,
  merchantSlug: string,
  options?: { signal?: AbortSignal }
) {
  try {
    const response = await fetchWithCsrf(
      `/api/storefront/customer/wallet/top-up/usdt/${encodeURIComponent(reference)}?merchantSlug=${encodeURIComponent(merchantSlug)}`,
      { method: 'GET', signal: options?.signal }
    );
    const data = record(await response.json());
    if (response.ok && data?.success === true) {
      return {
        amount: typeof data.amount === 'number' ? data.amount : null,
        chain: typeof data.chain === 'string' ? data.chain : null,
        depositAddress:
          typeof data.depositAddress === 'string' ? data.depositAddress : null,
        fundingStatus:
          typeof data.fundingStatus === 'string'
            ? data.fundingStatus
            : 'pending',
        kind: 'ready' as const,
      };
    }
    return { kind: 'error' as const };
  } catch {
    return { kind: 'error' as const };
  }
}

export const usdtWalletFundingApi = { initialize, status };
