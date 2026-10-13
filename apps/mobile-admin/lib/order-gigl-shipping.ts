import { z } from 'zod';
import { createAuthenticatedFetch } from '@/hooks/orders/authenticated-fetch';
import { BASE_URL } from '@/lib/api-client';

const REQUEST_TIMEOUT_MS = 20_000;

const quoteSchema = z.object({
  id: z.string().uuid(),
  provider: z.literal('GIGL'),
  serviceTier: z.string(),
  carrierName: z.string(),
  displayName: z.string(),
  estimatedDays: z.number().nonnegative(),
  deliveryRange: z.string().optional(),
  price: z.number().positive(),
  currency: z.literal('NGN'),
  pickupIncluded: z.boolean(),
  insuranceIncluded: z.boolean(),
  expiresAt: z.string().datetime(),
});

const quoteResultSchema = z.object({
  quote: quoteSchema,
  availableBalance: z.number().nonnegative(),
  shortfall: z.number().nonnegative(),
  canBook: z.boolean(),
  boundChargeRecovery: z.boolean().optional(),
});

const fundingAccountSchema = z.object({
  accountName: z.string().nullable(),
  accountNumber: z.string().regex(/^\d{10,20}$/),
  bankName: z.string().nullable(),
  currency: z.literal('NGN'),
  status: z.enum(['pending', 'active', 'disabled']),
});

const fundingAccountResponseSchema = z.object({
  account: fundingAccountSchema.nullable(),
  status: z.enum(['pending', 'active']).optional(),
});

const walletSchema = z.object({
  availableBalance: z.number().nonnegative(),
  currency: z.literal('NGN'),
});

const errorSchema = z.object({
  error: z.string().optional(),
  code: z.string().optional(),
  missing: z.array(z.enum(['address', 'city', 'state', 'phone'])).optional(),
});

export type OrderGiglQuote = z.infer<typeof quoteSchema>;
export type OrderGiglQuoteResult = z.infer<typeof quoteResultSchema>;
export type MerchantWalletFundingAccount = z.infer<typeof fundingAccountSchema>;
export type MerchantWalletSummary = z.infer<typeof walletSchema>;
export type OrderGiglMissingField = NonNullable<
  z.infer<typeof errorSchema>['missing']
>[number];

export interface OrderGiglReceiver {
  address: string;
  city?: string;
  state?: string;
  phone: string;
  latitude?: number;
  longitude?: number;
}

export class OrderGiglShippingError extends Error {
  code?: string;
  missing: OrderGiglMissingField[];
  status: number;

  constructor(
    message: string,
    status: number,
    code?: string,
    missing: OrderGiglMissingField[] = []
  ) {
    super(message);
    this.name = 'OrderGiglShippingError';
    this.code = code;
    this.missing = missing;
    this.status = status;
  }
}

async function parseResponse<T>(response: Response, schema: z.ZodType<T>) {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = errorSchema.safeParse(body);
    throw new OrderGiglShippingError(
      error.success ? error.data.error || 'Request failed' : 'Request failed',
      response.status,
      error.success ? error.data.code : undefined,
      error.success ? error.data.missing : undefined
    );
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new Error('Invalid server response');
  return parsed.data;
}

export async function getOrderGiglQuote(
  orderId: string,
  receiver?: OrderGiglReceiver,
  signal?: AbortSignal,
  preview = false
) {
  const response = await createAuthenticatedFetch(
    `${BASE_URL}/api/orders/${encodeURIComponent(orderId)}/shipping/gigl-quote`,
    {
      body: JSON.stringify({
        ...(receiver ? { receiver } : {}),
        ...(preview ? { preview: true } : {}),
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      signal,
    },
    REQUEST_TIMEOUT_MS
  );
  return parseResponse(response, quoteResultSchema);
}

export async function getMerchantWalletFundingAccount(signal?: AbortSignal) {
  const response = await createAuthenticatedFetch(
    `${BASE_URL}/api/merchant-wallet/funding-account`,
    { method: 'GET', signal },
    REQUEST_TIMEOUT_MS
  );
  return (await parseResponse(response, fundingAccountResponseSchema)).account;
}

export async function getOrRequestMerchantWalletFundingAccount(
  signal?: AbortSignal
) {
  const account = await getMerchantWalletFundingAccount(signal);
  if (account?.status === 'active') {
    return { account, status: account.status as 'active' };
  }
  // Pending or missing accounts must go through POST so recovery can resume a
  // stuck funding request after a lost assignment webhook.
  return requestMerchantWalletFundingAccount(signal);
}

export async function requestMerchantWalletFundingAccount(
  signal?: AbortSignal
) {
  const response = await createAuthenticatedFetch(
    `${BASE_URL}/api/merchant-wallet/funding-account`,
    {
      body: JSON.stringify({ consent: true }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      signal,
    },
    REQUEST_TIMEOUT_MS
  );
  return parseResponse(response, fundingAccountResponseSchema);
}

export async function getMerchantWalletSummary(signal?: AbortSignal) {
  const response = await createAuthenticatedFetch(
    `${BASE_URL}/api/merchant-wallet`,
    { method: 'GET', signal },
    REQUEST_TIMEOUT_MS
  );
  return parseResponse(response, walletSchema);
}
