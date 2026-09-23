/**
 * Paystack Payment Integration
 * Supports payments, subaccounts, and bank verification for Nigeria
 *
 * 2025 Best Practices:
 * - Zod validation for API responses
 * - Result types for recoverable errors
 * - Const assertions for literal types
 * - Structured logging
 * - Input validation with SSRF prevention
 */

import z from 'zod';
import { logger } from './logger';

// =============================================================================
// Configuration
// =============================================================================

const PAYSTACK_BASE_URL = 'https://api.paystack.co';
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || '';

// Platform fee percentage (2%) capped at ₦2,050
const PLATFORM_FEE_PERCENTAGE = 2;
const PLATFORM_FEE_CAP_NAIRA = 2050;
const PLATFORM_FEE_CAP_KOBO = PLATFORM_FEE_CAP_NAIRA * 100;

// =============================================================================
// Type Definitions
// =============================================================================

const PAYMENT_STATUSES = ['success', 'failed', 'abandoned', 'pending'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

const PAYMENT_CHANNELS = [
  'card',
  'bank',
  'ussd',
  'qr',
  'mobile_money',
  'bank_transfer',
] as const;
export type PaymentChannel = (typeof PAYMENT_CHANNELS)[number];

// =============================================================================
// Zod Schemas
// =============================================================================

const BankSchema = z.object({
  id: z.number(),
  name: z.string(),
  slug: z.string(),
  code: z.string(),
  longcode: z.string(),
  gateway: z.string().nullable(),
  pay_with_bank: z.boolean(),
  active: z.boolean(),
  is_deleted: z.boolean(),
  country: z.string(),
  currency: z.string(),
  type: z.string(),
});

const ResolvedAccountSchema = z.object({
  account_number: z.string(),
  account_name: z.string(),
  bank_id: z.number().optional(),
});

const SubaccountResponseSchema = z.object({
  id: z.number(),
  subaccount_code: z.string(),
  business_name: z.string(),
  description: z.string().nullable(),
  primary_contact_name: z.string().nullable(),
  primary_contact_email: z.string().nullable(),
  primary_contact_phone: z.string().nullable(),
  percentage_charge: z.number(),
  settlement_bank: z.string(),
  account_number: z.string(),
});

const PaymentInitResponseSchema = z.object({
  authorization_url: z.url(),
  access_code: z.string(),
  reference: z.string(),
});

const CustomerSchema = z.object({
  id: z.number(),
  email: z.email(),
  customer_code: z.string(),
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  phone: z.string().nullable(),
});

const AuthorizationSchema = z.object({
  authorization_code: z.string(),
  card_type: z.string().nullable(),
  last4: z.string().nullable(),
  exp_month: z.string().nullable(),
  exp_year: z.string().nullable(),
  bin: z.string().nullable().optional(),
  bank: z.string().nullable(),
  channel: z.string().nullable(),
  signature: z.string().nullable(),
  reusable: z.boolean(),
  country_code: z.string().nullable(),
  brand: z.string().nullable().optional(),
  account_name: z.string().nullable().optional(),
});

const PaymentVerificationSchema = z.object({
  id: z.number(),
  status: z.enum(PAYMENT_STATUSES),
  reference: z.string(),
  amount: z.number(),
  requested_amount: z.number().optional(),
  currency: z.string(),
  channel: z.string(),
  paid_at: z.string().nullable(),
  created_at: z.string(),
  customer: CustomerSchema,
  metadata: z.record(z.string(), z.unknown()).nullable(),
  authorization: AuthorizationSchema.nullable().optional(),
  fees: z.number(),
  fees_split: z
    .object({
      paystack: z.number(),
      integration: z.number(),
      subaccount: z.number(),
    })
    .nullable(),
});

// =============================================================================
// TypeScript Interfaces
// =============================================================================

export type Bank = z.infer<typeof BankSchema>;
export type SubaccountResponse = z.infer<typeof SubaccountResponseSchema>;
export type PaymentInitResponse = z.infer<typeof PaymentInitResponseSchema>;
export type PaymentVerificationResponse = z.infer<
  typeof PaymentVerificationSchema
>;
export type PaystackAuthorization = z.infer<typeof AuthorizationSchema>;

export function getPaystackRequestedAmountNgn(
  payload: Record<string, unknown>
) {
  const rawRequestedAmount = payload.requested_amount;
  const rawAmount =
    typeof rawRequestedAmount === 'number' &&
    Number.isFinite(rawRequestedAmount) &&
    rawRequestedAmount > 0
      ? rawRequestedAmount
      : payload.amount;

  if (
    typeof rawAmount !== 'number' ||
    !Number.isFinite(rawAmount) ||
    !Number.isInteger(rawAmount) ||
    rawAmount <= 0
  ) {
    return null;
  }

  return rawAmount / 100;
}

const ChargeAuthorizationResponseSchema = z.object({
  amount: z.number(),
  currency: z.string(),
  status: z.string(),
  reference: z.string(),
  gateway_response: z.string().nullable(),
  message: z.string().nullable(),
  authorization_url: z.url().optional(),
  access_code: z.string().optional(),
  paused: z.boolean().optional(),
  authorization: AuthorizationSchema.nullable().optional(),
  customer: CustomerSchema.optional(),
  id: z.number().optional(),
});
export type ChargeAuthorizationResponse = z.infer<
  typeof ChargeAuthorizationResponseSchema
>;

export interface Subaccount {
  business_name: string;
  settlement_bank: string;
  account_number: string;
  percentage_charge: number;
  description?: string;
  primary_contact_email?: string;
  primary_contact_name?: string;
  primary_contact_phone?: string;
  metadata?: Record<string, unknown>;
}

export interface PaymentInitData {
  email: string;
  amount: number; // Amount in kobo (NGN smallest unit)
  reference?: string;
  callback_url?: string;
  metadata?: Record<string, unknown>;
  subaccount?: string; // Subaccount code for split payments
  transaction_charge?: number; // Platform fee in kobo
  bearer?: 'account' | 'subaccount'; // Who bears the transaction charges
  channels?: PaymentChannel[];
  phone?: string; // Optional phone number for customer creation/updates
}

export interface ChargeAuthorizationData {
  amount: number;
  authorization_code: string;
  callback_url?: string;
  email: string;
  metadata?: Record<string, unknown>;
  reference?: string;
}

export interface WalletDedicatedAccount {
  providerAccountId: string | null;
  providerCustomerCode: string;
  providerSubaccountCode: string;
  accountNumber: string;
  accountName: string;
  bankName: string;
  bankSlug: string | null;
  currency: 'NGN';
}

export interface WalletDedicatedAccountInput {
  customerCode: string;
  subaccount: string;
  preferredBank?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
}

// =============================================================================
// Result Type
// =============================================================================

export type PaystackResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string };

// =============================================================================
// API Client
// =============================================================================

interface PaystackApiResponse<T> {
  status: boolean;
  message: string;
  data: T;
}

async function paystackRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<PaystackResult<T>> {
  const url = `${PAYSTACK_BASE_URL}${endpoint}`;

  if (!PAYSTACK_SECRET_KEY) {
    return {
      success: false,
      error: 'PAYSTACK_SECRET_KEY is not configured',
      code: 'CONFIG_ERROR',
    };
  }

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        ...options.headers,
      },
    });

    const data: PaystackApiResponse<T> = await response.json();

    logger.info({
      message: 'Paystack API Response',
      endpoint,
      status: response.status,
      success: data.status,
    });

    if (!response.ok || !data.status) {
      logger.error({
        message: 'Paystack API Error',
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
    logger.error({ message: 'Paystack request failed', error: message });
    return { success: false, error: message, code: 'NETWORK_ERROR' };
  }
}

// =============================================================================
// Bank Functions
// =============================================================================

/**
 * Fetch list of banks from Paystack
 */
export async function getBanks(country = 'nigeria'): Promise<Bank[]> {
  const result = await paystackRequest<Bank[]>(
    `/bank?country=${encodeURIComponent(country)}`
  );

  if (!result.success) {
    logger.error({ message: 'Failed to fetch banks', error: result.error });
    return [];
  }

  // Validate and filter valid banks
  const validBanks = result.data.filter(
    (bank) => BankSchema.safeParse(bank).success
  );
  return validBanks;
}

/**
 * Resolve account number to verify name
 */
export async function resolveAccountNumber(
  accountNumber: string,
  bankCode: string
): Promise<
  PaystackResult<{
    account_number: string;
    account_name: string;
    bank_id?: number;
  }>
> {
  // Validate inputs
  if (!accountNumber || !bankCode) {
    return {
      success: false,
      error: 'Account number and bank code are required',
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

  if (!/^[A-Za-z0-9]{2,16}$/.test(bankCode.trim())) {
    return {
      success: false,
      error: 'Bank code is invalid',
      code: 'VALIDATION_ERROR',
    };
  }

  const result = await paystackRequest<{
    account_number: string;
    account_name: string;
  }>(`/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`);

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
// Subaccount Functions
// =============================================================================

/**
 * Create a subaccount for a merchant
 */
export async function createSubaccount(
  payload: Subaccount
): Promise<PaystackResult<SubaccountResponse>> {
  // Validate required fields
  if (
    !payload.business_name ||
    !payload.settlement_bank ||
    !payload.account_number
  ) {
    return {
      success: false,
      error: 'Missing required subaccount fields',
      code: 'VALIDATION_ERROR',
    };
  }

  const result = await paystackRequest<SubaccountResponse>('/subaccount', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  if (!result.success) {
    return result;
  }

  const parsed = SubaccountResponseSchema.safeParse(result.data);
  if (!parsed.success) {
    logger.warn({
      message: 'Subaccount response validation warning',
      issues: parsed.error.issues,
    });
  }

  return { success: true, data: result.data };
}

/**
 * Update a subaccount
 */
export async function updateSubaccount(
  subaccountCode: string,
  payload: Partial<Subaccount>
): Promise<PaystackResult<SubaccountResponse>> {
  // Validate subaccount code format (e.g., ACCT_xxxxx)
  if (!subaccountCode || !/^ACCT_[a-z0-9]+$/i.test(subaccountCode)) {
    return {
      success: false,
      error: 'Invalid subaccount code format',
      code: 'VALIDATION_ERROR',
    };
  }

  const result = await paystackRequest<SubaccountResponse>(
    `/subaccount/${encodeURIComponent(subaccountCode)}`,
    {
      method: 'PUT',
      body: JSON.stringify(payload),
    }
  );

  return result;
}

// =============================================================================
// Payment Functions
// =============================================================================

/**
 * Initialize a Paystack transaction
 */
export async function initializeTransaction(
  payload: PaymentInitData
): Promise<PaymentInitResponse> {
  // Validate required fields
  if (!payload.email || !payload.amount) {
    throw new Error('Email and amount are required');
  }

  if (payload.amount < 100) {
    throw new Error('Amount must be at least 100 kobo (₦1)');
  }

  const result = await paystackRequest<PaymentInitResponse>(
    '/transaction/initialize',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    }
  );

  if (!result.success) {
    throw new Error(result.error);
  }

  // Validate response
  const parsed = PaymentInitResponseSchema.safeParse(result.data);
  if (!parsed.success) {
    logger.warn({
      message: 'Payment init response validation warning',
      issues: parsed.error.issues,
    });
  }

  return result.data;
}

/**
 * Verify a Paystack transaction
 */
export async function verifyTransaction(
  reference: string
): Promise<PaystackResult<PaymentVerificationResponse>> {
  // Validate reference format to prevent SSRF attacks
  // Paystack references are typically alphanumeric with some special chars
  if (!reference || !/^[A-Za-z0-9_-]{1,100}$/.test(reference)) {
    return {
      success: false,
      error: 'Invalid transaction reference format',
      code: 'VALIDATION_ERROR',
    };
  }

  const result = await paystackRequest<PaymentVerificationResponse>(
    `/transaction/verify/${encodeURIComponent(reference)}`
  );

  if (!result.success) {
    return result;
  }

  // Validate response
  const parsed = PaymentVerificationSchema.safeParse(result.data);
  if (!parsed.success) {
    logger.warn({
      message: 'Payment verification response validation warning',
      issues: parsed.error.issues,
    });
  }

  return { success: true, data: result.data };
}

export async function chargeAuthorization(
  payload: ChargeAuthorizationData
): Promise<PaystackResult<ChargeAuthorizationResponse>> {
  if (!payload.authorization_code || !payload.email || !payload.amount) {
    return {
      success: false,
      error: 'Authorization code, email, and amount are required',
      code: 'VALIDATION_ERROR',
    };
  }

  const result = await paystackRequest<ChargeAuthorizationResponse>(
    '/transaction/charge_authorization',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    }
  );

  if (!result.success) {
    return result;
  }

  const parsed = ChargeAuthorizationResponseSchema.safeParse(result.data);
  if (!parsed.success) {
    logger.warn({
      message: 'Charge authorization response validation warning',
      issues: parsed.error.issues,
    });
  }

  return { success: true, data: result.data };
}

/**
 * Initiate a refund for a Paystack transaction
 * @param transaction - Transaction reference or ID
 * @param amount - Amount to refund in kobo (optional, defaults to full amount)
 * @param reason - Reason for refund (optional)
 */
export async function initiateRefund(
  transaction: string,
  amount?: number,
  reason?: string
): Promise<
  PaystackResult<{
    id: number;
    status: string;
    transaction: { reference: string };
  }>
> {
  // Validate transaction reference format
  if (!transaction || !/^[A-Za-z0-9_-]{1,100}$/.test(transaction)) {
    return {
      success: false,
      error: 'Invalid transaction reference format',
      code: 'VALIDATION_ERROR',
    };
  }

  const payload: Record<string, unknown> = { transaction };
  if (amount !== undefined && amount > 0) {
    payload.amount = amount;
  }
  if (reason) {
    payload.customer_note = reason;
  }

  const result = await paystackRequest<{
    id: number;
    status: string;
    transaction: { reference: string };
  }>('/refund', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  if (!result.success) {
    logger.error({
      message: 'Paystack refund failed',
      transaction,
      error: result.error,
    });
  } else {
    logger.info({
      message: 'Paystack refund initiated',
      transaction,
      refundId: result.data?.id,
      status: result.data?.status,
    });
  }

  return result;
}

// =============================================================================
// Dedicated Virtual Account (DVA) Functions
// =============================================================================

/**
 * Customer creation data for DVA
 */
export interface CustomerData {
  email: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  metadata?: Record<string, unknown>;
}

/**
 * DVA creation response from Paystack
 */
export interface DedicatedAccountResponse {
  bank: {
    name: string;
    id: number;
    slug: string;
  };
  account_name: string;
  account_number: string;
  assigned: boolean;
  currency: string;
  metadata: Record<string, unknown> | null;
  active: boolean;
  id: number;
  created_at: string;
  updated_at: string;
  customer: {
    id: number;
    email: string;
    customer_code: string;
    first_name: string | null;
    last_name: string | null;
  };
  split_config?:
    | {
        subaccount?: string | null;
      }
    | string
    | null;
}

const WalletDedicatedAccountSplitConfigObjectSchema = z
  .object({
    subaccount: z.string().min(1).nullable().optional(),
  })
  .passthrough();

const WalletDedicatedAccountResponseSchema = z.object({
  id: z.union([z.number(), z.string()]).nullable().optional(),
  bank: z.object({
    name: z.string().min(1),
    slug: z.string().min(1).nullable().optional(),
  }),
  account_name: z.string().min(1),
  account_number: z.string().regex(/^\d{10}$/),
  currency: z.literal('NGN'),
  customer: z
    .object({
      customer_code: z.string().min(1).optional(),
    })
    .passthrough()
    .optional(),
  split_config: z
    .union([WalletDedicatedAccountSplitConfigObjectSchema, z.string()])
    .nullable()
    .optional(),
});

function parseWalletDedicatedAccountSplitConfig(
  value: DedicatedAccountResponse['split_config']
) {
  if (!value) {
    return null;
  }

  if (typeof value !== 'string') {
    return value;
  }

  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return null;
  }

  try {
    const parsed = WalletDedicatedAccountSplitConfigObjectSchema.safeParse(
      JSON.parse(trimmedValue)
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function extractPaystackSplitConfigSubaccount(
  value: DedicatedAccountResponse['split_config']
): string | null {
  const subaccount =
    parseWalletDedicatedAccountSplitConfig(value)?.subaccount?.trim() ?? '';

  return subaccount || null;
}

/**
 * Customer response from Paystack
 */
export interface PaystackCustomer {
  id: number;
  email: string;
  customer_code: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
}

/**
 * Create or retrieve a Paystack customer
 * Required before creating a DVA
 */
export async function createOrGetCustomer(
  data: CustomerData
): Promise<PaystackResult<PaystackCustomer>> {
  if (!data.email) {
    return {
      success: false,
      error: 'Customer email is required',
      code: 'VALIDATION_ERROR',
    };
  }

  const result = await paystackRequest<PaystackCustomer>('/customer', {
    method: 'POST',
    body: JSON.stringify({
      email: data.email,
      first_name: data.first_name,
      last_name: data.last_name,
      phone: data.phone,
      metadata: data.metadata,
    }),
  });

  return result;
}

/**
 * Create a Dedicated Virtual Account for a customer
 * This generates a unique bank account number that the customer can transfer to
 *
 * @param customerCode - Paystack customer code (e.g., CUS_xxx)
 * @param options - Additional options including preferredBank, phone, firstName, lastName
 */
export async function createDedicatedAccount(
  customerCode: string,
  options: {
    preferredBank?: string;
    phone?: string;
    firstName?: string;
    lastName?: string;
    metadata?: Record<string, unknown>;
  } = {}
): Promise<PaystackResult<DedicatedAccountResponse>> {
  // Validate customer code format
  if (!customerCode?.startsWith('CUS_')) {
    return {
      success: false,
      error: 'Invalid customer code format. Expected CUS_xxx',
      code: 'VALIDATION_ERROR',
    };
  }

  const {
    preferredBank = 'wema-bank',
    phone,
    firstName,
    lastName,
    metadata,
  } = options;

  const result = await paystackRequest<DedicatedAccountResponse>(
    '/dedicated_account',
    {
      method: 'POST',
      body: JSON.stringify({
        customer: customerCode,
        preferred_bank: preferredBank,
        ...(phone && { phone }),
        ...(firstName && { first_name: firstName }),
        ...(lastName && { last_name: lastName }),
        ...(metadata && { metadata }),
      }),
    }
  );

  if (!result.success) {
    logger.error({
      message: 'Failed to create DVA',
      customerCode,
      error: result.error,
    });
  } else {
    logger.info({
      message: 'DVA created successfully',
      customerCode,
      outcome: 'account_assigned',
    });
  }

  return result;
}

function resolveWalletDvaPreferredBank(preferredBank?: string): string {
  if (
    process.env.PAYSTACK_WALLET_DVA_USE_TEST_BANK === 'true' ||
    process.env.PAYSTACK_DVA_USE_TEST_BANK === 'true'
  ) {
    return 'test-bank';
  }

  return (
    preferredBank ||
    process.env.PAYSTACK_WALLET_DVA_PREFERRED_BANK ||
    process.env.PAYSTACK_DVA_PREFERRED_BANK ||
    'wema-bank'
  );
}

export async function createDedicatedAccountForWallet(
  input: WalletDedicatedAccountInput
): Promise<PaystackResult<WalletDedicatedAccount>> {
  if (!input.customerCode?.startsWith('CUS_')) {
    return {
      success: false,
      error: 'Invalid customer code format. Expected CUS_xxx',
      code: 'VALIDATION_ERROR',
    };
  }

  if (!/^ACCT_[A-Za-z0-9]+$/.test(input.subaccount || '')) {
    return {
      success: false,
      error: 'Invalid Paystack subaccount code format',
      code: 'VALIDATION_ERROR',
    };
  }

  const result = await paystackRequest<unknown>('/dedicated_account', {
    method: 'POST',
    body: JSON.stringify({
      customer: input.customerCode,
      preferred_bank: resolveWalletDvaPreferredBank(input.preferredBank),
      subaccount: input.subaccount,
      ...(input.phone && { phone: input.phone }),
      ...(input.firstName && { first_name: input.firstName }),
      ...(input.lastName && { last_name: input.lastName }),
    }),
  });

  if (!result.success) {
    return result;
  }

  const parsed = WalletDedicatedAccountResponseSchema.safeParse(result.data);
  if (!parsed.success) {
    logger.warn({
      message: 'Wallet DVA response validation failed',
      issues: parsed.error.issues,
    });
    return {
      success: false,
      error: 'Invalid wallet DVA response',
      code: 'VALIDATION_ERROR',
    };
  }

  const walletAccount = parsed.data;
  const providerSplitConfigSubaccount = extractPaystackSplitConfigSubaccount(
    walletAccount.split_config
  );
  if (
    providerSplitConfigSubaccount &&
    providerSplitConfigSubaccount !== input.subaccount
  ) {
    return {
      success: false,
      error: 'Wallet DVA response returned a different Paystack subaccount',
      code: 'VALIDATION_ERROR',
    };
  }

  const providerSubaccountCode =
    providerSplitConfigSubaccount ?? input.subaccount;

  if (!providerSubaccountCode) {
    return {
      success: false,
      error: 'Wallet DVA response did not include a Paystack subaccount',
      code: 'VALIDATION_ERROR',
    };
  }

  return {
    success: true,
    data: {
      providerAccountId:
        walletAccount.id === undefined || walletAccount.id === null
          ? null
          : String(walletAccount.id),
      providerCustomerCode:
        walletAccount.customer?.customer_code ?? input.customerCode,
      providerSubaccountCode,
      accountNumber: walletAccount.account_number,
      accountName: walletAccount.account_name,
      bankName: walletAccount.bank.name,
      bankSlug: walletAccount.bank.slug ?? null,
      currency: walletAccount.currency,
    },
  };
}

/**
 * Fetch existing DVAs for a customer
 */
export async function getDedicatedAccounts(
  customerCode: string
): Promise<PaystackResult<DedicatedAccountResponse[]>> {
  if (!customerCode?.startsWith('CUS_')) {
    return {
      success: false,
      error: 'Invalid customer code format',
      code: 'VALIDATION_ERROR',
    };
  }

  const result = await paystackRequest<DedicatedAccountResponse[]>(
    `/dedicated_account?customer=${encodeURIComponent(customerCode)}`
  );

  return result;
}

const PAYSTACK_DVA_ACCOUNT_PATTERN = /^\d{10}$/;

export function extractPaystackReceiverAccountNumber(
  payload: unknown
): string | null {
  if (!payload || typeof payload !== 'object' || !('data' in payload)) {
    return null;
  }

  const data = (payload as { data?: unknown }).data;
  if (!data || typeof data !== 'object') {
    return null;
  }

  const dataRecord = data as Record<string, unknown>;
  const authorization = dataRecord.authorization;
  const authorizationRecord =
    authorization && typeof authorization === 'object'
      ? (authorization as Record<string, unknown>)
      : {};
  const dedicatedAccount = dataRecord.dedicated_account;
  const dedicatedAccountRecord =
    dedicatedAccount && typeof dedicatedAccount === 'object'
      ? (dedicatedAccount as Record<string, unknown>)
      : {};

  const candidates = [
    dataRecord.receiver_account_number,
    dataRecord.receiver_bank_account_number,
    dedicatedAccountRecord.account_number,
    authorizationRecord.receiver_bank_account_number,
    authorizationRecord.receiver_account_number,
  ];

  const accountNumber = candidates.find(
    (value): value is string =>
      typeof value === 'string' && PAYSTACK_DVA_ACCOUNT_PATTERN.test(value)
  );

  return accountNumber ?? null;
}

/**
 * High-level function: Create customer and DVA in one call
 * This is the main function for chatbot payment integration
 */
export async function generatePaymentAccount(data: {
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  orderId?: string;
}): Promise<
  PaystackResult<{
    bank_name: string;
    account_number: string;
    account_name: string;
    customer_code: string;
  }>
> {
  // Step 1: Create or get customer
  const customerResult = await createOrGetCustomer({
    email: data.email,
    first_name: data.firstName,
    last_name: data.lastName,
    phone: data.phone,
    metadata: data.orderId ? { order_id: data.orderId } : undefined,
  });

  if (!customerResult.success) {
    return customerResult;
  }

  const customerCode = customerResult.data.customer_code;

  // Step 2: Check for existing DVA
  const existingResult = await getDedicatedAccounts(customerCode);
  if (existingResult.success && existingResult.data.length > 0) {
    const existing = existingResult.data[0];
    return {
      success: true,
      data: {
        bank_name: existing.bank.name,
        account_number: existing.account_number,
        account_name: existing.account_name,
        customer_code: customerCode,
      },
    };
  }

  // Step 3: Create new DVA
  const dvaResult = await createDedicatedAccount(customerCode, {
    phone: data.phone,
    firstName: data.firstName,
    lastName: data.lastName,
  });
  if (!dvaResult.success) {
    return dvaResult;
  }

  return {
    success: true,
    data: {
      bank_name: dvaResult.data.bank.name,
      account_number: dvaResult.data.account_number,
      account_name: dvaResult.data.account_name,
      customer_code: customerCode,
    },
  };
}

// =============================================================================
// Transaction Splits API
// =============================================================================

const SplitResponseSchema = z.object({
  id: z.number(),
  name: z.string(),
  type: z.string(),
  currency: z.string(),
  split_code: z.string(),
  active: z.boolean(),
  bearer_type: z.string(),
  bearer_subaccount: z.string().nullable(),
  subaccounts: z.array(
    z.object({
      subaccount: SubaccountResponseSchema,
      share: z.number(),
    })
  ),
});

export type SplitResponse = z.infer<typeof SplitResponseSchema>;

export interface SplitPayload {
  name: string;
  type: 'percentage' | 'flat';
  currency: string;
  subaccounts: Array<{ subaccount: string; share: number }>;
  bearer_type?: 'subaccount' | 'account' | 'all' | 'none';
  bearer_subaccount?: string;
}

/**
 * Create a transaction split group
 */
export async function createTransactionSplit(
  payload: SplitPayload
): Promise<PaystackResult<SplitResponse>> {
  const result = await paystackRequest<SplitResponse>('/split', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  if (!result.success) return result;

  const parsed = SplitResponseSchema.safeParse(result.data);
  if (!parsed.success) {
    logger.warn({
      message: 'Split response validation warning',
      issues: parsed.error.issues,
    });
  }

  return { success: true, data: result.data };
}

// =============================================================================
// Transfers API (Payouts)
// =============================================================================

const TransferRecipientSchema = z.object({
  recipient_code: z.string(),
  type: z.string(),
  name: z.string(),
  details: z.object({
    account_number: z.string(),
    bank_code: z.string(),
    bank_name: z.string(),
  }),
});

const TransferResponseSchema = z.object({
  amount: z.number(),
  currency: z.string(),
  transfer_code: z.string(),
  status: z.string(),
  recipient: z.number(),
  id: z.number(),
});

export type TransferRecipient = z.infer<typeof TransferRecipientSchema>;
export type TransferResponse = z.infer<typeof TransferResponseSchema>;

/**
 * Create a transfer recipient (merchant) for payouts
 */
export async function createTransferRecipient(data: {
  type: 'nuban';
  name: string;
  account_number: string;
  bank_code: string;
  currency?: string;
}): Promise<PaystackResult<TransferRecipient>> {
  const result = await paystackRequest<TransferRecipient>(
    '/transferrecipient',
    {
      method: 'POST',
      body: JSON.stringify(data),
    }
  );

  return result;
}

/**
 * Initiate a transfer payout to a merchant
 */
export async function initiateTransfer(data: {
  source: 'balance';
  amount: number; // in kobo
  recipient: string; // recipient code
  reason?: string;
  currency?: string;
  reference?: string;
}): Promise<PaystackResult<TransferResponse>> {
  const result = await paystackRequest<TransferResponse>('/transfer', {
    method: 'POST',
    body: JSON.stringify(data),
  });

  return result;
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Calculate platform fee for split payments
 * Platform takes 2%, capped at ₦2,050
 * Amount should be in kobo
 */
export function calculatePlatformFee(amountInKobo: number): {
  platformFee: number; // in kobo
  merchantAmount: number; // in kobo
  total: number; // in kobo
} {
  let platformFee = Math.round((amountInKobo * PLATFORM_FEE_PERCENTAGE) / 100);
  platformFee = Math.min(platformFee, PLATFORM_FEE_CAP_KOBO);

  const merchantAmount = amountInKobo - platformFee;

  return {
    platformFee,
    merchantAmount,
    total: amountInKobo,
  };
}

/**
 * Get Paystack public key for frontend
 */
export function getPublicKey(): string {
  return process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY || '';
}

/**
 * Check if Paystack is properly configured
 */
export function isPaystackConfigured(): boolean {
  return Boolean(PAYSTACK_SECRET_KEY);
}

/**
 * Validate payment channel
 */
export function isValidChannel(channel: string): channel is PaymentChannel {
  return PAYMENT_CHANNELS.includes(channel as PaymentChannel);
}

export { PLATFORM_FEE_PERCENTAGE };

// =============================================================================
// Virtual Terminal API (WhatsApp Payment Notifications)
// =============================================================================

/**
 * Virtual Terminal destination for WhatsApp notifications
 */
export interface VirtualTerminalDestination {
  target: string; // WhatsApp phone number (E.164 format)
  type: 'whatsapp';
  name: string; // Descriptive label
  created_at?: string;
}

/**
 * Virtual Terminal payment method (NUBAN for Nigeria)
 */
export interface VirtualTerminalPaymentMethod {
  dedicated_nuban_id?: number;
  type: 'dedicated_nuban' | string;
  account_number: string;
  account_name: string;
  bank: string;
}

/**
 * Virtual Terminal response from Paystack
 *
 * For Nigeria: Includes a Dedicated Virtual Account (NUBAN) in paymentMethods
 * For Kenya: Includes M-Pesa Paybill
 * For Ghana: Includes USSD code
 *
 * @see https://paystack.com/docs/payments/virtual-terminal
 */
export interface VirtualTerminalResponse {
  id: number;
  code: string; // VT_XXXXX
  name: string;
  integration: number;
  domain: 'test' | 'live';
  /** Payment methods - for Nigeria, this contains the NUBAN account details */
  paymentMethods: VirtualTerminalPaymentMethod[];
  active: boolean;
  created_at: string;
  currency: string;
  metadata: Record<string, unknown> | null;
  destinations?: VirtualTerminalDestination[];
  connect_account_id?: string | null;
}

const VirtualTerminalPaymentMethodSchema = z.object({
  dedicated_nuban_id: z.number().optional(),
  type: z.string(),
  account_number: z.string(),
  account_name: z.string(),
  bank: z.string(),
});

const _VirtualTerminalSchema = z.object({
  id: z.number(),
  code: z.string(),
  name: z.string(),
  integration: z.number(),
  domain: z.string(),
  paymentMethods: z.array(VirtualTerminalPaymentMethodSchema),
  active: z.boolean(),
  created_at: z.string(),
  currency: z.string(),
});

/**
 * Create a Virtual Terminal with WhatsApp notification destinations
 *
 * @param name - Name of the Virtual Terminal (e.g., "OgaBassey Sales")
 * @param destinations - Array of WhatsApp numbers to notify on payment
 * @param currency - Transaction currency (defaults to NGN)
 */
export async function createVirtualTerminal(
  name: string,
  destinations: Array<{ target: string; name: string }>,
  currency = 'NGN'
): Promise<PaystackResult<VirtualTerminalResponse>> {
  if (!name || name.length < 2) {
    return {
      success: false,
      error: 'Terminal name must be at least 2 characters',
      code: 'VALIDATION_ERROR',
    };
  }

  if (destinations.length > 5) {
    return {
      success: false,
      error: 'Maximum 5 WhatsApp destinations allowed per terminal',
      code: 'VALIDATION_ERROR',
    };
  }

  // Validate phone numbers (E.164 format)
  for (const dest of destinations) {
    if (!dest.target.startsWith('+') || dest.target.length < 10) {
      return {
        success: false,
        error: `Invalid phone number format: ${dest.target}. Use E.164 format (e.g., +2348012345678)`,
        code: 'VALIDATION_ERROR',
      };
    }
  }

  const result = await paystackRequest<VirtualTerminalResponse>(
    '/virtual_terminal',
    {
      method: 'POST',
      body: JSON.stringify({
        name,
        destinations,
        currency,
      }),
    }
  );

  if (result.success) {
    logger.info({
      message: 'Virtual Terminal created',
      code: result.data.code,
      destinations: destinations.length,
    });
  }

  return result;
}

/**
 * List all Virtual Terminals on the integration
 */
export async function listVirtualTerminals(
  options: {
    status?: 'active' | 'inactive';
    perPage?: number;
    search?: string;
  } = {}
): Promise<PaystackResult<VirtualTerminalResponse[]>> {
  const params = new URLSearchParams();
  if (options.status) params.append('status', options.status);
  if (options.perPage) params.append('perPage', options.perPage.toString());
  if (options.search) params.append('search', options.search);

  const queryString = params.toString();
  const endpoint = queryString
    ? `/virtual_terminal?${queryString}`
    : '/virtual_terminal';

  return await paystackRequest<VirtualTerminalResponse[]>(endpoint);
}

/**
 * Fetch a specific Virtual Terminal by code
 */
export async function fetchVirtualTerminal(
  code: string
): Promise<PaystackResult<VirtualTerminalResponse>> {
  if (!code?.startsWith('VT_')) {
    return {
      success: false,
      error: 'Invalid Virtual Terminal code. Expected format: VT_XXXXX',
      code: 'VALIDATION_ERROR',
    };
  }

  return await paystackRequest<VirtualTerminalResponse>(
    `/virtual_terminal/${encodeURIComponent(code)}`
  );
}

/**
 * Update a Virtual Terminal's name
 */
export async function updateVirtualTerminal(
  code: string,
  name: string
): Promise<PaystackResult<VirtualTerminalResponse>> {
  if (!code?.startsWith('VT_')) {
    return {
      success: false,
      error: 'Invalid Virtual Terminal code',
      code: 'VALIDATION_ERROR',
    };
  }

  return await paystackRequest<VirtualTerminalResponse>(
    `/virtual_terminal/${encodeURIComponent(code)}`,
    {
      method: 'PUT',
      body: JSON.stringify({ name }),
    }
  );
}

/**
 * Deactivate a Virtual Terminal
 */
export async function deactivateVirtualTerminal(
  code: string
): Promise<PaystackResult<{ message: string }>> {
  if (!code?.startsWith('VT_')) {
    return {
      success: false,
      error: 'Invalid Virtual Terminal code',
      code: 'VALIDATION_ERROR',
    };
  }

  return await paystackRequest<{ message: string }>(
    `/virtual_terminal/${encodeURIComponent(code)}/deactivate`,
    { method: 'PUT' }
  );
}

/**
 * Add WhatsApp destinations to a Virtual Terminal
 *
 * @param code - Virtual Terminal code (VT_XXXXX)
 * @param destinations - Array of WhatsApp numbers with labels
 */
export async function assignVirtualTerminalDestinations(
  code: string,
  destinations: Array<{ target: string; name: string }>
): Promise<PaystackResult<VirtualTerminalDestination[]>> {
  if (!code?.startsWith('VT_')) {
    return {
      success: false,
      error: 'Invalid Virtual Terminal code',
      code: 'VALIDATION_ERROR',
    };
  }

  if (destinations.length === 0) {
    return {
      success: false,
      error: 'At least one destination is required',
      code: 'VALIDATION_ERROR',
    };
  }

  return await paystackRequest<VirtualTerminalDestination[]>(
    `/virtual_terminal/${encodeURIComponent(code)}/destination/assign`,
    {
      method: 'POST',
      body: JSON.stringify({ destinations }),
    }
  );
}

/**
 * Remove WhatsApp destinations from a Virtual Terminal
 *
 * @param code - Virtual Terminal code (VT_XXXXX)
 * @param targets - Array of phone numbers to remove
 */
export async function unassignVirtualTerminalDestinations(
  code: string,
  targets: string[]
): Promise<PaystackResult<{ message: string }>> {
  if (!code?.startsWith('VT_')) {
    return {
      success: false,
      error: 'Invalid Virtual Terminal code',
      code: 'VALIDATION_ERROR',
    };
  }

  return await paystackRequest<{ message: string }>(
    `/virtual_terminal/${encodeURIComponent(code)}/destination/unassign`,
    {
      method: 'POST',
      body: JSON.stringify({ targets }),
    }
  );
}

/**
 * Add a split code to a Virtual Terminal for automatic revenue splitting
 * This connects the terminal to a subaccount for instant payouts
 */
export async function addSplitToVirtualTerminal(
  code: string,
  splitCode: string
): Promise<PaystackResult<SplitResponse>> {
  if (!code?.startsWith('VT_')) {
    return {
      success: false,
      error: 'Invalid Virtual Terminal code',
      code: 'VALIDATION_ERROR',
    };
  }

  if (!splitCode?.startsWith('SPL_')) {
    return {
      success: false,
      error: 'Invalid split code. Expected format: SPL_XXXXX',
      code: 'VALIDATION_ERROR',
    };
  }

  return await paystackRequest<SplitResponse>(
    `/virtual_terminal/${encodeURIComponent(code)}/split_code`,
    {
      method: 'PUT',
      body: JSON.stringify({ split_code: splitCode }),
    }
  );
}

/**
 * Remove a split code from a Virtual Terminal
 */
export async function removeSplitFromVirtualTerminal(
  code: string,
  splitCode: string
): Promise<PaystackResult<{ message: string }>> {
  if (!code?.startsWith('VT_')) {
    return {
      success: false,
      error: 'Invalid Virtual Terminal code',
      code: 'VALIDATION_ERROR',
    };
  }

  return await paystackRequest<{ message: string }>(
    `/virtual_terminal/${encodeURIComponent(code)}/split_code`,
    {
      method: 'DELETE',
      body: JSON.stringify({ split_code: splitCode }),
    }
  );
}
