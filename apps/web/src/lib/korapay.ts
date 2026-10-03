/**
 * Korapay Payment Integration
 * Supports multi-currency payments, conversions, and payouts across Africa
 *
 * 2025 Best Practices:
 * - Zod validation for API responses
 * - Result types for recoverable errors
 * - Const assertions for literal types
 * - Structured logging
 * - Type-safe currency handling
 */

import z from 'zod';
import { logger } from './logger';
import { calculatePlatformFee as computePlatformFee } from './payments/platform-fee';

// =============================================================================
// Configuration
// =============================================================================

const KORAPAY_BASE_URL =
  process.env.KORAPAY_BASE_URL || 'https://api.korapay.com/merchant/api/v1';
const KORAPAY_SECRET_KEY = process.env.KORAPAY_SECRET_KEY || '';
const KORAPAY_PUBLIC_KEY = process.env.KORAPAY_PUBLIC_KEY || '';

// Platform fee percentage (2%) capped at ₦2,050
const PLATFORM_FEE_PERCENTAGE = Number.parseFloat(
  process.env.PLATFORM_FEE_PERCENTAGE || '2'
);

// =============================================================================
// Type Definitions
// =============================================================================

export const SUPPORTED_CURRENCIES = [
  'NGN',
  'KES',
  'GHS',
  'ZAR',
  'XAF',
  'XOF',
] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

export const CURRENCY_SYMBOLS: Record<Currency, string> = {
  NGN: '₦',
  KES: 'KSh',
  GHS: 'GH₵',
  ZAR: 'R',
  XAF: 'FCFA',
  XOF: 'CFA',
};

export const CURRENCY_NAMES: Record<Currency, string> = {
  NGN: 'Nigerian Naira',
  KES: 'Kenyan Shilling',
  GHS: 'Ghanaian Cedi',
  ZAR: 'South African Rand',
  XAF: 'Central African CFA Franc',
  XOF: 'West African CFA Franc',
};

const PAYMENT_STATUSES = ['success', 'pending', 'failed'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

const PAYOUT_STATUSES = ['processing', 'success', 'failed'] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

// =============================================================================
// Zod Schemas
// =============================================================================

const PaymentInitResponseSchema = z
  .object({
    reference: z.string(),
    checkout_url: z.url().optional(),
    authorization_url: z.url().optional(),
  })
  .refine(
    (value) =>
      typeof value.checkout_url === 'string' ||
      typeof value.authorization_url === 'string',
    {
      message:
        'Korapay response must include checkout_url or authorization_url',
    }
  );

const PaymentVerificationSchema = z.object({
  reference: z.string(),
  amount: z.number(),
  currency: z.string(),
  status: z.enum(PAYMENT_STATUSES),
  customer: z.object({
    name: z.string(),
    email: z.email(),
  }),
  paid_at: z.string(),
  created_at: z.string(),
});

const ExchangeRateSchema = z.object({
  source_currency: z.string(),
  destination_currency: z.string(),
  rate: z.number(),
});

const ConversionResponseSchema = z.object({
  source_currency: z.string(),
  destination_currency: z.string(),
  source_amount: z.number(),
  destination_amount: z.number(),
  rate: z.number(),
  reference: z.string(),
});

const PayoutResponseSchema = z.object({
  reference: z.string(),
  status: z.enum(PAYOUT_STATUSES),
  amount: z.number(),
  fee: z.number(),
  currency: z.string(),
});

const BankSchema = z.object({
  name: z.string(),
  code: z.string(),
});

const ResolvedAccountSchema = z.object({
  account_name: z.string(),
  account_number: z.string(),
});

// =============================================================================
// TypeScript Interfaces
// =============================================================================

type PaymentInitGatewayPayload = z.infer<typeof PaymentInitResponseSchema>;
export interface PaymentInitResponse {
  reference: string;
  checkout_url: string;
  authorization_url: string;
}
export type PaymentVerificationResponse = z.infer<
  typeof PaymentVerificationSchema
>;
export type ExchangeRateResponse = z.infer<typeof ExchangeRateSchema>;
export type ConversionResponse = z.infer<typeof ConversionResponseSchema>;
export type PayoutResponse = z.infer<typeof PayoutResponseSchema>;

export interface PaymentInitData {
  amount: number;
  currency: Currency;
  customer: {
    name: string;
    email: string;
  };
  merchant_bears_cost?: boolean;
  redirect_url?: string;
  reference?: string;
  narration?: string;
  notification_url?: string;
  metadata?: Record<string, unknown>;
}

export interface ConversionRequest {
  source_currency: Currency;
  destination_currency: Currency;
  amount: number;
}

export interface PayoutRequest {
  reference: string;
  destination: {
    type: 'bank_account';
    amount: number;
    currency: Currency;
    narration: string;
    bank_account: {
      bank: string;
      account: string;
      account_name?: string;
    };
    customer: {
      name: string;
      email?: string;
    };
  };
}

// =============================================================================
// Result Type
// =============================================================================

export type KorapayResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string };

// =============================================================================
// API Client
// =============================================================================

interface KorapayApiResponse<T> {
  status: boolean;
  message: string;
  data: T;
}

async function korapayRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<KorapayResult<T>> {
  const url = `${KORAPAY_BASE_URL}${endpoint}`;

  if (!KORAPAY_SECRET_KEY) {
    return {
      success: false,
      error: 'KORAPAY_SECRET_KEY is not configured',
      code: 'CONFIG_ERROR',
    };
  }

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${KORAPAY_SECRET_KEY}`,
        ...options.headers,
      },
    });

    const data: KorapayApiResponse<T> = await response.json();

    logger.info({
      message: 'Korapay API Response',
      endpoint,
      status: response.status,
      success: data.status,
    });

    if (!response.ok || !data.status) {
      logger.error({
        message: 'Korapay API Error',
        status: response.status,
        error: data.message,
      });
      return {
        success: false,
        error: data.message || `API request failed: ${response.status}`,
        code: `HTTP_${response.status}`,
      };
    }

    return { success: true, data: data.data };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Network error';
    logger.error({ message: 'Korapay request failed', error: message });
    return { success: false, error: message, code: 'NETWORK_ERROR' };
  }
}

// =============================================================================
// Public API Functions
// =============================================================================

/**
 * Initialize payment checkout
 */
export async function initializePayment(
  data: PaymentInitData
): Promise<PaymentInitResponse> {
  const result = await korapayRequest<PaymentInitGatewayPayload>(
    '/charges/initialize',
    {
      method: 'POST',
      body: JSON.stringify({
        amount: data.amount,
        currency: data.currency,
        customer: data.customer,
        merchant_bears_cost: data.merchant_bears_cost ?? true,
        redirect_url: data.redirect_url,
        reference: data.reference,
        narration: data.narration,
        notification_url: data.notification_url,
        metadata: data.metadata,
      }),
    }
  );

  if (!result.success) {
    throw new Error(result.error);
  }

  // Validate and normalize response: Korapay may omit authorization_url
  // while still returning a usable checkout_url.
  const parsed = PaymentInitResponseSchema.safeParse(result.data);
  if (!parsed.success) {
    logger.error({
      message: 'Korapay payment init response validation failed',
      issues: parsed.error.issues,
      payload: result.data,
    });
    throw new Error('Invalid Korapay payment initialization response');
  }

  const authorizationUrl =
    parsed.data.authorization_url ?? parsed.data.checkout_url;
  const checkoutUrl = parsed.data.checkout_url ?? parsed.data.authorization_url;

  if (!authorizationUrl || !checkoutUrl) {
    logger.error({
      message: 'Korapay payment init response missing usable checkout URL',
      payload: result.data,
    });
    throw new Error('Korapay checkout URL is missing');
  }

  return {
    reference: parsed.data.reference,
    authorization_url: authorizationUrl,
    checkout_url: checkoutUrl,
  };
}

/**
 * Verify payment status (with Result type)
 */
export async function verifyPayment(
  reference: string,
  signal?: AbortSignal
): Promise<KorapayResult<PaymentVerificationResponse>> {
  // Validate reference format
  if (!reference || !/^[A-Za-z0-9_-]{1,100}$/.test(reference)) {
    return {
      success: false,
      error: 'Invalid reference format',
      code: 'VALIDATION_ERROR',
    };
  }

  const result = await korapayRequest<PaymentVerificationResponse>(
    `/charges/${encodeURIComponent(reference)}/verify`,
    { method: 'GET', signal }
  );

  if (!result.success) {
    return result;
  }

  // Validate response
  const parsed = PaymentVerificationSchema.safeParse(result.data);
  if (!parsed.success) {
    logger.warn({
      message: 'Korapay verification response validation warning',
      issues: parsed.error.issues,
    });
  }

  return { success: true, data: result.data };
}

/**
 * Get exchange rate between currencies
 */
export async function getExchangeRate(
  sourceCurrency: Currency,
  destinationCurrency: Currency
): Promise<KorapayResult<ExchangeRateResponse>> {
  const result = await korapayRequest<ExchangeRateResponse>(
    `/misc/exchange-rates?source_currency=${sourceCurrency}&destination_currency=${destinationCurrency}`,
    { method: 'GET' }
  );

  if (!result.success) {
    return result;
  }

  const parsed = ExchangeRateSchema.safeParse(result.data);
  if (!parsed.success) {
    logger.warn({
      message: 'Exchange rate response validation warning',
      issues: parsed.error.issues,
    });
  }

  return { success: true, data: result.data };
}

/**
 * Convert currency amount
 */
export async function convertCurrency(
  data: ConversionRequest
): Promise<KorapayResult<ConversionResponse>> {
  const result = await korapayRequest<ConversionResponse>('/balances/convert', {
    method: 'POST',
    body: JSON.stringify(data),
  });

  if (!result.success) {
    return result;
  }

  const parsed = ConversionResponseSchema.safeParse(result.data);
  if (!parsed.success) {
    logger.warn({
      message: 'Conversion response validation warning',
      issues: parsed.error.issues,
    });
  }

  return { success: true, data: result.data };
}

/**
 * Send payout to bank account
 */
export async function sendPayout(
  data: PayoutRequest
): Promise<KorapayResult<PayoutResponse>> {
  const result = await korapayRequest<PayoutResponse>(
    '/transactions/disburse',
    {
      method: 'POST',
      body: JSON.stringify(data),
    }
  );

  if (!result.success) {
    return result;
  }

  const parsed = PayoutResponseSchema.safeParse(result.data);
  if (!parsed.success) {
    logger.warn({
      message: 'Payout response validation warning',
      issues: parsed.error.issues,
    });
  }

  return { success: true, data: result.data };
}

/**
 * Send bulk payouts to multiple accounts
 */
export async function sendBulkPayouts(
  payouts: PayoutRequest[]
): Promise<KorapayResult<PayoutResponse[]>> {
  const result = await korapayRequest<PayoutResponse[]>(
    '/transactions/disburse/bulk',
    {
      method: 'POST',
      body: JSON.stringify({ payouts }),
    }
  );

  return result;
}

/**
 * Get available banks for a country
 */
export async function getBanks(
  country: 'NG' | 'KE' | 'GH' | 'ZA'
): Promise<KorapayResult<Array<{ name: string; code: string }>>> {
  const result = await korapayRequest<Array<{ name: string; code: string }>>(
    `/misc/banks?country=${country}`,
    { method: 'GET' }
  );

  if (!result.success) {
    return result;
  }

  // Validate each bank
  const validBanks = result.data.filter(
    (bank) => BankSchema.safeParse(bank).success
  );

  return { success: true, data: validBanks };
}

/**
 * Resolve bank account details
 */
export async function resolveBankAccount(
  bankCode: string,
  accountNumber: string
): Promise<KorapayResult<{ account_name: string; account_number: string }>> {
  // Validate inputs
  if (!bankCode || !accountNumber) {
    return {
      success: false,
      error: 'Bank code and account number are required',
      code: 'VALIDATION_ERROR',
    };
  }

  if (!/^\d{10}$/.test(accountNumber)) {
    return {
      success: false,
      error: 'Account number must be 10 digits',
      code: 'VALIDATION_ERROR',
    };
  }

  const result = await korapayRequest<{
    account_name: string;
    account_number: string;
  }>('/misc/banks/resolve', {
    method: 'POST',
    body: JSON.stringify({
      bank: bankCode,
      account: accountNumber,
    }),
  });

  if (!result.success) {
    return result;
  }

  const parsed = ResolvedAccountSchema.safeParse(result.data);
  if (!parsed.success) {
    return {
      success: false,
      error: 'Invalid account resolution response',
      code: 'VALIDATION_ERROR',
    };
  }

  return { success: true, data: result.data };
}

// =============================================================================
// Virtual Bank Account
// =============================================================================

interface VirtualAccountRequest {
  accountName: string;
  customerEmail?: string;
  amount?: number;
  orderId?: string;
  merchantId?: string;
}

interface VirtualAccountResponse {
  accountNumber: string;
  bankName: string;
  accountName: string;
  expiresAt?: string;
  reference?: string;
}

/**
 * Create a virtual bank account for payment collection
 * Useful for credit orders where customers pay later
 */
export async function createVirtualBankAccount(
  data: VirtualAccountRequest
): Promise<KorapayResult<VirtualAccountResponse>> {
  const reference = `VA-${Date.now()}-${crypto.randomUUID().split('-')[0]}`;

  const result = await korapayRequest<{
    account_number: string;
    bank_name: string;
    account_name: string;
    expires_at?: string;
    reference?: string;
  }>('/virtual-bank-account/initialize', {
    method: 'POST',
    body: JSON.stringify({
      account_name: data.accountName,
      account_reference: reference,
      permanent: false, // Temporary account for this order
      bank_code: '035', // Wema Bank (default for Korapay virtual accounts)
      customer: {
        email: data.customerEmail || 'customer@example.com',
      },
      min_amount: data.amount ? data.amount * 0.9 : undefined, // Allow 10% tolerance
      max_amount: data.amount ? data.amount * 1.1 : undefined,
      notification_url: `${process.env.NEXT_PUBLIC_APP_URL || 'https://usebaci.com'}/api/webhooks/korapay`,
      metadata: {
        order_id: data.orderId,
        merchant_id: data.merchantId,
      },
    }),
  });

  if (!result.success) {
    return result;
  }

  return {
    success: true,
    data: {
      accountNumber: result.data.account_number,
      bankName: result.data.bank_name,
      accountName: result.data.account_name,
      expiresAt: result.data.expires_at,
      reference: result.data.reference || reference,
    },
  };
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Calculate platform fee and merchant amount (amounts in major currency units).
 *
 * Platform takes 2%, **capped at ₦2,050 for NGN ONLY**. Every other Lane-0
 * currency (KES/GHS/ZAR/XAF/XOF) is percentage-only / uncapped — Korapay is
 * charged in the order's own currency, so applying the naira cap as a bare `2050`
 * in a foreign currency silently under-collected the platform fee on every large
 * non-NGN sale (a KES 500,000 order accrued KES 2,050 instead of KES 10,000).
 *
 * The `currency` is a REQUIRED input, not an assumption; it defaults to `'NGN'`
 * so any un-threaded legacy caller keeps today's exact behaviour. The computation
 * is delegated to the shared `lib/payments/platform-fee` module with the options
 * that reproduce this function's historical arithmetic bit-for-bit (env-percentage
 * override, major units, cents rounding), so NGN is byte-for-byte unchanged.
 */
export function calculatePlatformFee(
  amount: number,
  currency: Currency = 'NGN'
): {
  platformFee: number;
  merchantAmount: number;
  total: number;
} {
  return computePlatformFee(amount, {
    currency,
    unit: 'major',
    rounding: 'cents',
    honorEnvPercentageOverride: true,
  });
}

/**
 * Get Korapay public key for frontend
 */
export function getPublicKey(): string {
  return KORAPAY_PUBLIC_KEY;
}

/**
 * Format currency amount with symbol
 */
export function formatCurrency(amount: number, currency: Currency): string {
  const symbol = CURRENCY_SYMBOLS[currency] || currency;
  return `${symbol}${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Detect currency from country code
 */
export function getCurrencyFromCountry(countryCode: string): Currency {
  const currencyMap: Record<string, Currency> = {
    NG: 'NGN',
    KE: 'KES',
    GH: 'GHS',
    ZA: 'ZAR',
    CM: 'XAF',
    CI: 'XOF',
    SN: 'XOF',
    BF: 'XOF',
  };

  return currencyMap[countryCode.toUpperCase()] || 'NGN';
}

/**
 * Validate if a currency is supported
 */
export function isSupportedCurrency(currency: string): currency is Currency {
  return SUPPORTED_CURRENCIES.includes(currency as Currency);
}

/**
 * Check if Korapay is properly configured
 */
export function isKorapayConfigured(): boolean {
  return Boolean(KORAPAY_SECRET_KEY);
}

export { PLATFORM_FEE_PERCENTAGE };
