import crypto from 'node:crypto';
import { logKudaResponse } from '@/lib/kuda-debug-log';
import {
  KudaApiHttpError,
  KudaPreDispatchError,
} from '@/lib/kuda-transport-error';

/**
 * Kuda authentication + request transport, moved here from kuda.ts
 * (Codex R107 P1) per the 300-line ceiling: env config, the
 * service-type enum, token acquisition with its cache, and the
 * authenticated request wrapper with envelope normalization.
 * kuda.ts re-exports the shared names so existing importers
 * (kuda-bills, tests) are untouched.
 */
// Environment configuration
const KUDA_API_BASE_URL =
  process.env.KUDA_API_BASE_URL || 'https://kuda-openapi.kuda.com/v2.1';
const KUDA_EMAIL = process.env.KUDA_EMAIL || '';
const KUDA_API_KEY = process.env.KUDA_API_KEY || '';
const KUDA_REQUEST_TIMEOUT_MS = 15000;

// Service Types for Kuda API
export enum KudaServiceType {
  // Authentication

  // Bill Services
  GET_BILLERS = 'GET_BILLERS',
  GET_BILLERS_BY_TYPE = 'GET_BILLERS_BY_TYPE',
  VERIFY_BILL_CUSTOMER = 'VERIFY_BILL_CUSTOMER',
  ADMIN_PURCHASE_BILL = 'ADMIN_PURCHASE_BILL',
  BILL_TSQ = 'BILL_TSQ', // Transaction status query
  ADMIN_GET_PURCHASED_BILLS = 'ADMIN_GET_PURCHASED_BILLS',

  // Virtual Account Services

  // Transfer Services
  BANK_LIST = 'BANK_LIST',
  NAME_ENQUIRY = 'NAME_ENQUIRY',
  SINGLE_FUND_TRANSFER = 'SINGLE_FUND_TRANSFER',

  // Account Services
  ADMIN_MAIN_ACCOUNT_BALANCE = 'ADMIN_MAIN_ACCOUNT_BALANCE',
}

export interface KudaApiResponse<T = unknown> {
  status: boolean;
  message: string;
  data?: T;
}

// Token storage (in production, use Redis or database)
let cachedToken: { token: string; expiresAt: number } | null = null;

function createTimeoutSignal(timeoutMs: number) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timeoutId),
  };
}

/**
 * Generate a provider-safe request reference.
 * Kuda bill purchases are sensitive to punctuation-heavy refs.
 */
export function generateRequestRef(): string {
  return crypto.randomBytes(12).toString('hex');
}

/**
 * Get authentication token from Kuda
 */
async function getToken(): Promise<string> {
  // Check if we have a valid cached token
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token;
  }

  const { signal, cleanup } = createTimeoutSignal(KUDA_REQUEST_TIMEOUT_MS);
  let response: Response;

  try {
    response = await fetch(`${KUDA_API_BASE_URL}/Account/GetToken`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: KUDA_EMAIL,
        apiKey: KUDA_API_KEY,
      }),
      signal,
    });
  } catch (error) {
    // Pre-dispatch (Codex R103 P1): no provider request was sent,
    // so this is a known failure, not an ambiguous vend outcome.
    // Match aborts by name across prototypes: fetch rejects with a
    // DOMException, which is not an instanceof Error.
    if (
      (error instanceof Error || error instanceof DOMException) &&
      error.name === 'AbortError'
    ) {
      throw new KudaPreDispatchError('Kuda authentication request timed out');
    }

    throw new KudaPreDispatchError(
      error instanceof Error ? error.message : String(error)
    );
  } finally {
    cleanup();
  }

  if (!response.ok) {
    throw new KudaPreDispatchError(
      `Failed to get Kuda token: ${response.statusText}`
    );
  }

  let token: string;
  try {
    token = await response.text();
  } catch (error) {
    throw new KudaPreDispatchError(
      error instanceof Error ? error.message : String(error)
    );
  }

  // Cache token for 55 minutes (tokens expire in 1 hour)
  cachedToken = {
    token,
    expiresAt: Date.now() + 55 * 60 * 1000,
  };

  return token;
}

/**
 * Make authenticated request to Kuda API.
 *
 * Kuda's response envelope uses inconsistent casing across endpoints
 * (e.g. `Status` vs `status`, `Data` vs `data`). This function normalizes
 * the outer envelope to consistent camelCase before returning.
 */
export async function kudaRequest<T = unknown>(
  serviceType: KudaServiceType,
  data: Record<string, unknown> = {},
  requestRef?: string
): Promise<KudaApiResponse<T>> {
  const token = await getToken();
  const ref = requestRef || generateRequestRef();

  const payload = {
    serviceType,
    requestRef: ref,
    Data: data,
  };

  const { signal, cleanup } = createTimeoutSignal(KUDA_REQUEST_TIMEOUT_MS);
  let response: Response;

  try {
    response = await fetch(KUDA_API_BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Kuda ${serviceType} request timed out`);
    }

    throw error;
  } finally {
    cleanup();
  }

  if (!response.ok) {
    throw new KudaApiHttpError(response.status, response.statusText);
  }

  const raw = await response.json();
  logKudaResponse({
    requestRef: ref,
    serviceType,
  });

  // Normalize Kuda's mixed-case envelope (Status/status, Message/message, Data/data).
  // Some endpoints (e.g. VERIFY_BILL_CUSTOMER) return BOTH `data` and `Data` with
  // different payloads — merge them so callers see all fields.
  const lowerData = raw.data as Record<string, unknown> | undefined;
  const upperData = raw.Data as Record<string, unknown> | undefined;
  const mergedData =
    lowerData && upperData
      ? { ...lowerData, ...upperData }
      : (lowerData ?? upperData);

  return {
    status: raw.status ?? raw.Status ?? false,
    message: raw.message ?? raw.Message ?? '',
    data: mergedData as T | undefined,
  };
}
