const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;

import { logger } from '@/lib/logger';

if (!PAYSTACK_SECRET_KEY && process.env.NODE_ENV === 'production') {
  console.warn('PAYSTACK_SECRET_KEY is not set');
}

/**
 * Validates that an email is in proper format to prevent SSRF attacks
 * when used in URL paths. Returns the encoded email if valid.
 */
function validateAndEncodeEmail(email: string): string {
  // Limit email length to prevent potential ReDoS attacks on the regex engine
  if (!email || email.length > 320) {
    throw new Error('Invalid email length');
  }

  // Use a simple, non-polynomial regex for basic format validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new Error('Invalid email format');
  }

  // Ensure email doesn't contain path traversal or URL manipulation characters
  if (
    email.includes('/') ||
    email.includes('\\') ||
    email.includes('..') ||
    email.includes('://') ||
    email.includes('\n') ||
    email.includes('\r') ||
    email.includes('\0')
  ) {
    throw new Error('Email contains invalid characters');
  }

  // URL-encode the email to safely include in paths
  return encodeURIComponent(email);
}

/**
 * Sanitize potentially user-controlled strings before logging to prevent
 * log injection (for example, forged new log lines or control characters).
 */
function sanitizeForLog(value: unknown, maxLength = 500): string {
  const str = String(value ?? '');
  // Replace all ASCII control characters (0x00-0x1F, 0x7F) with spaces
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Intentionally matching control chars for sanitization
  const withoutControls = str.replace(/[\x00-\x1F\x7F]/g, ' ');
  // Collapse repeated whitespace and trim to keep logs concise
  const normalized = withoutControls.replace(/\s+/g, ' ').trim();
  return normalized.slice(0, maxLength);
}

export interface PaystackCustomer {
  email: string;
  first_name: string;
  last_name: string;
  phone: string;
}

export interface DVAResponse {
  account_number: string;
  account_name: string;
  bank_name: string;
  currency: string;
  assigned: boolean;
}

const PAYSTACK_SUBACCOUNT_PATTERN = /^ACCT_[A-Za-z0-9]{15}$/;

export function isValidPaystackSubaccountCode(
  value: string | null | undefined
): value is string {
  return typeof value === 'string' && PAYSTACK_SUBACCOUNT_PATTERN.test(value);
}

async function paystackRequest(
  endpoint: string,
  method: string,
  body?: unknown
) {
  // Build-time safety: If key is missing during build, don't crash, but fail at runtime
  const secretKey = PAYSTACK_SECRET_KEY || 'sk_test_placeholder';

  // SSRF Protection: Ensure endpoint is relative and safe
  if (!endpoint.startsWith('/') || endpoint.includes('://')) {
    throw new Error(`Invalid Paystack endpoint: ${endpoint}`);
  }

  const res = await fetch(`https://api.paystack.co${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const errorBody = await res.text();
    // Sanitize error body before including in Error to prevent log injection
    const safeErrorBody = sanitizeForLog(errorBody, 200);
    throw new Error(`Paystack API Error ${res.status}: ${safeErrorBody}`);
  }

  return res.json();
}

export async function getOrCreatePaystackCustomer(
  customer: PaystackCustomer
): Promise<string> {
  try {
    // Validate email early to prevent SSRF attacks
    const encodedEmail = validateAndEncodeEmail(customer.email);

    // 1. Try to create customer using the protected paystackRequest helper
    const createData = await paystackRequest('/customer', 'POST', customer);

    if (createData.status) {
      return createData.data.customer_code;
    }

    // If failed, likely exists. Try to fetch by email.
    if (
      createData.message?.toLowerCase().includes('duplicate') ||
      createData.status === false
    ) {
      // Only fetch if it failed.
      // Note: Paystack unfortunately doesn't always return the code in error.
      // We must query using the validated and encoded email.
      const getData = await paystackRequest(`/customer/${encodedEmail}`, 'GET');
      if (getData.status) {
        return getData.data.customer_code;
      }
    }

    // Sanitize API response message before including in error to prevent log injection
    const sanitizedMessage = sanitizeForLog(
      createData.message || 'Unknown error',
      200
    );
    throw new Error(
      `Could not create or retrieve customer: ${sanitizedMessage}`
    );
  } catch (error) {
    // Sanitize error message to prevent log injection before logging
    const safeMessage =
      error instanceof Error ? sanitizeForLog(error.message) : 'Unknown error';
    logger.error({ message: 'Paystack Customer Error', error: safeMessage });
    throw error;
  }
}

export async function createDedicatedVirtualAccount(
  customer: PaystackCustomer,
  options: { subaccount: string }
): Promise<DVAResponse> {
  const secretKey = PAYSTACK_SECRET_KEY;
  if (!secretKey) {
    throw new Error('PAYSTACK_SECRET_KEY is not configured');
  }
  if (!isValidPaystackSubaccountCode(options.subaccount)) {
    throw new Error('Paystack subaccount is not configured');
  }

  const customerCode = await getOrCreatePaystackCustomer(customer);

  // Create DVA — always include customer details (wema-bank requires phone)
  const baseDvaPayload: Record<string, string> = {
    customer: customerCode,
    first_name: customer.first_name || 'Customer',
    last_name: customer.last_name || 'User',
    phone: customer.phone || '00000000000',
    subaccount: options.subaccount,
  };

  // An error can arrive after Paystack has created the account. Without a
  // definitive rejection contract, retrying at another bank may create two.
  const res: {
    status: boolean;
    message?: string;
    data: {
      account_number: string;
      account_name: string;
      bank?: { name: string };
      assignment?: { bank_name: string };
      currency?: string;
    };
  } = await paystackRequest('/dedicated_account', 'POST', {
    ...baseDvaPayload,
    preferred_bank: 'wema-bank',
  });

  if (!res.status) {
    const safeMessage = sanitizeForLog(res.message || 'Unknown DVA error', 200);
    throw new Error(`Failed to assign DVA: ${safeMessage}`);
  }

  return {
    account_number: res.data.account_number,
    account_name: res.data.account_name,
    bank_name: res.data.bank?.name || res.data.assignment?.bank_name || 'Bank',
    currency: res.data.currency || 'NGN',
    assigned: true,
  };
}
