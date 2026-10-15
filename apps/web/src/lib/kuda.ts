/**
 * Kuda Open API Client Library
 * Provides VTU (Value Top-Up) services: Airtime, Data, Bills
 *
 * API Documentation: https://docs.kuda.com/
 */

import crypto from 'node:crypto';
import { logKudaResponse } from '@/lib/kuda-debug-log';
import {
  extractKudaTransactionId,
  extractKudaVoucherPin,
  type KudaVoucherTokenField,
  normalizeKudaString,
} from '@/lib/kuda-voucher-token';
import {
  getKudaVtuCommissionRate,
  VTU_COMMISSION_RATES,
  type VtuCommissionCategory,
} from '@/lib/vtu-commission-rates';

export { extractKudaVoucherPin } from '@/lib/kuda-voucher-token';
export { detectNetworkProvider } from './detect-network-provider';

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

// Bill Types
export enum BillType {
  AIRTIME = 'airtime',
  DATA = 'internet_data',
  ELECTRICITY = 'electricity',
  CABLE_TV = 'cable_tv',
  BETTING = 'betting',
}

// Network Providers
export enum NetworkProvider {
  MTN = 'MTN',
  AIRTEL = 'AIRTEL',
  GLO = 'GLO',
  MOBILE_9 = '9MOBILE',
}

// Data Plan Types
export interface DataPlan {
  id: string;
  name: string;
  amount: number;
  validity: string;
  provider: NetworkProvider;
}

// Biller Information (normalized from Kuda's PascalCase response)
export interface Biller {
  billerId: string;
  billerName: string;
  billerType: string;
  categoryId: string;
  categoryName: string;
  billerIconUrl?: string;
  billItems?: BillItem[];
}

/**
 * Raw biller shape returned by Kuda API (PascalCase).
 * See: https://docs.kuda.com/ — GET_BILLERS_BY_TYPE
 */
interface KudaRawBiller {
  Id: string;
  Name: string;
  Description: string;
  BillerIconUrl?: string;
  BillTypeId: string;
  BillItems?: unknown[];
}

interface KudaRawBillItem {
  ItemCode?: string;
  itemCode?: string;
  KudaIdentifier?: string;
  kudaIdentifier?: string;
  ItemName?: string;
  itemName?: string;
  Name?: string;
  name?: string;
  Amount?: number | string;
  amount?: number | string;
  ItemCurrencySymbol?: string;
  itemCurrencySymbol?: string;
  IsAmountFixed?: boolean;
  isAmountFixed?: boolean;
  IsFixedPrice?: boolean;
  isFixedPrice?: boolean;
  ItemFee?: number | string;
  itemFee?: number | string;
  BillItems?: unknown[];
  billItems?: unknown[];
}

function toNumber(value: number | string | undefined, fallback = 0) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallback;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
}

function mapBillItem(raw: unknown): BillItem | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const item = raw as KudaRawBillItem;
  const itemCode =
    normalizeKudaString(item.ItemCode) ??
    normalizeKudaString(item.itemCode) ??
    normalizeKudaString(item.KudaIdentifier) ??
    normalizeKudaString(item.kudaIdentifier);
  const itemName =
    normalizeKudaString(item.ItemName) ??
    normalizeKudaString(item.itemName) ??
    normalizeKudaString(item.Name) ??
    normalizeKudaString(item.name);

  if (!itemCode || !itemName) {
    return null;
  }

  return {
    itemCode,
    itemName,
    amount: toNumber(item.Amount ?? item.amount),
    itemCurrencySymbol:
      item.ItemCurrencySymbol ?? item.itemCurrencySymbol ?? 'NGN',
    isAmountFixed:
      item.IsAmountFixed ??
      item.isAmountFixed ??
      item.IsFixedPrice ??
      item.isFixedPrice ??
      false,
    itemFee: toNumber(item.ItemFee ?? item.itemFee),
    billItems: mapBillItems(item.BillItems ?? item.billItems),
  };
}

function mapBillItems(rawItems: unknown[] | undefined): BillItem[] | undefined {
  if (!rawItems || rawItems.length === 0) {
    return undefined;
  }

  const billItems = rawItems
    .map((rawItem) => mapBillItem(rawItem))
    .filter((item): item is BillItem => item !== null);

  return billItems.length > 0 ? billItems : undefined;
}

/**
 * Map a raw Kuda biller (PascalCase) to our normalized Biller interface.
 */
function mapKudaBiller(raw: KudaRawBiller, categoryName: string): Biller {
  return {
    billerId: raw.Id,
    billerName: raw.Name,
    billerType: raw.Description,
    categoryId: raw.BillTypeId,
    categoryName,
    billerIconUrl: raw.BillerIconUrl,
    billItems: mapBillItems(raw.BillItems),
  };
}

// Bill Item (specific product from a biller)
export interface BillItem {
  itemCode: string;
  itemName: string;
  amount: number;
  itemCurrencySymbol: string;
  isAmountFixed: boolean;
  itemFee: number;
  billItems?: BillItem[];
}

// Purchase Result
export interface PurchaseResult {
  success: boolean;
  reference: string;
  transactionId?: string;
  pin?: string;
  message: string;
  status: 'pending' | 'successful' | 'failed';
  amount: number;
  phoneNumber?: string;
  provider?: string;
  providerErrorDetail?: string;
  // Monnify-only: the provider's own vend reference, used to requery status
  // (Monnify resolves requery by this, not by transactionReference).
  providerVendReference?: string;
  // Units delivered for metered bills (e.g. prepaid electricity kWh).
  units?: string;
}

// Kuda API Response
interface KudaApiResponse<T = unknown> {
  status: boolean;
  message: string;
  data?: T;
}

export interface KudaTransactionStatusData {
  finalStatus?: string;
  FinalStatus?: string;
  transactionStatus?: number | string;
  TransactionStatus?: number | string;
  postingStatus?: number | string;
  PostingStatus?: number | string;
  billerAggregatorStatus?: string;
  BillerAggregatorStatus?: string;
  status?: number | string;
  Status?: number | string;
  message?: string;
  Message?: string;
  pin?: KudaVoucherTokenField;
  Pin?: KudaVoucherTokenField;
  PIN?: KudaVoucherTokenField;
  token?: KudaVoucherTokenField;
  Token?: KudaVoucherTokenField;
  meterToken?: KudaVoucherTokenField;
  MeterToken?: KudaVoucherTokenField;
  vendCode?: KudaVoucherTokenField;
  VendCode?: KudaVoucherTokenField;
  voucher?: KudaVoucherTokenField;
  Voucher?: KudaVoucherTokenField;
}

type KudaTransactionStatusResult = {
  message: string;
  pin?: string;
  status: string;
  // Units delivered for metered bills; surfaced by Monnify requery, kept on the
  // shared shape so the provider-agnostic status type stays consistent.
  units?: string;
};

function normalizeKudaStatusKey(status: string) {
  return status
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

const KUDA_SUCCESS_STATUS_KEYS = new Set([
  'completed',
  'complete',
  'success',
  'successful',
]);

// Token storage (in production, use Redis or database)
let cachedToken: { token: string; expiresAt: number } | null = null;

// Determine whether the vend itself succeeded.
// `response.status: true` means Kuda accepted the API call; the actual vend
// outcome is in `data.finalStatus` / `data.transactionStatus`. Treating the
// envelope status as success silently marks Kuda-rejected purchases as
// successful in our DB (the bug behind the EKEDC "reversal" reports).
//
// Kuda transactionStatus codes (observed):
//   2 = Failed, 3 = Successful. Some endpoints omit it; fall back to finalStatus.
export function isKudaVendSuccessful(
  envelopeStatus: boolean,
  data: KudaTransactionStatusData | undefined
): boolean {
  if (!envelopeStatus) return false;
  if (!data) return envelopeStatus;
  const final =
    normalizeKudaString(data.finalStatus) ??
    normalizeKudaString(data.FinalStatus);
  if (final) {
    if (KUDA_SUCCESS_STATUS_KEYS.has(normalizeKudaStatusKey(final))) {
      return true;
    }
    // Anything else with finalStatus set — failed, pending, processing,
    // in-progress, or any unrecognized non-terminal value — must NOT be
    // treated as success. Falling back to the envelope here would silently
    // credit cashback for vends that haven't actually settled.
    return false;
  }
  const txStatus =
    normalizeKudaString(data.transactionStatus) ??
    normalizeKudaString(data.TransactionStatus);
  if (txStatus !== undefined) {
    // 3 = Successful; everything else (2 = Failed, 1 = Pending, etc.) is
    // not a confirmed success.
    return txStatus === '3';
  }
  // Both finalStatus and transactionStatus absent: trust the envelope.
  return envelopeStatus;
}

export function buildKudaVendMessage(
  fallback: string | undefined,
  data: KudaTransactionStatusData | undefined
): string {
  // Category-neutral default: this helper is shared by airtime, data, and
  // bill (electricity / cable / betting) call sites. A "Bill purchase failed"
  // string would mislabel airtime/data failures.
  const base = fallback?.trim() || 'Purchase failed';
  const aggregator =
    normalizeKudaString(data?.billerAggregatorStatus) ??
    normalizeKudaString(data?.BillerAggregatorStatus);
  return aggregator ? `${base} (biller status: ${aggregator})` : base;
}

function normalizeKudaStatusLabel(status: string) {
  const compact = normalizeKudaStatusKey(status);
  if (KUDA_SUCCESS_STATUS_KEYS.has(compact)) {
    return 'successful';
  }
  if (
    compact === 'failed' ||
    compact === 'failure' ||
    compact === 'unsuccessful'
  ) {
    return 'failed';
  }
  if (
    compact === 'inprogress' ||
    compact === 'processing' ||
    compact === 'pending'
  ) {
    return 'pending';
  }
  return compact || 'unknown';
}

function extractKudaStatus(data: KudaTransactionStatusData | undefined) {
  if (!data) {
    return 'unknown';
  }

  const finalStatus =
    normalizeKudaString(data.finalStatus) ??
    normalizeKudaString(data.FinalStatus);
  if (finalStatus) {
    return normalizeKudaStatusLabel(finalStatus);
  }

  const transactionStatus =
    normalizeKudaString(data.transactionStatus) ??
    normalizeKudaString(data.TransactionStatus);
  if (transactionStatus === '3') return 'successful';
  if (transactionStatus === '2') return 'failed';
  if (transactionStatus === '1') return 'pending';

  return (
    transactionStatus ??
    normalizeKudaString(data.postingStatus) ??
    normalizeKudaString(data.PostingStatus) ??
    normalizeKudaString(data.status) ??
    normalizeKudaString(data.Status) ??
    'unknown'
  );
}

const KUDA_STATUS_PRIORITY: Record<string, number> = {
  completed: 3,
  complete: 3,
  success: 3,
  successful: 3,
  inprogress: 2,
  pending: 2,
  processing: 2,
  failed: 1,
  failure: 1,
  unsuccessful: 1,
};

function getKudaStatusPriority(status: string) {
  const normalized = status
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  return KUDA_STATUS_PRIORITY[normalized] ?? 0;
}

function getBestKudaStatus(currentStatus: string, nextStatus: string) {
  return getKudaStatusPriority(nextStatus) >
    getKudaStatusPriority(currentStatus)
    ? nextStatus
    : currentStatus;
}

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
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Kuda authentication request timed out');
    }

    throw error;
  } finally {
    cleanup();
  }

  if (!response.ok) {
    throw new Error(`Failed to get Kuda token: ${response.statusText}`);
  }

  const token = await response.text();

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
    throw new Error(`Kuda API request failed: ${response.statusText}`);
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

// ============================================
// AIRTIME & DATA SERVICES
// ============================================

/**
 * Get all available billers across all categories.
 *
 * Uses GET_BILLERS service type. Kuda returns:
 * { billers: [{ id, name, description, billerIconUrl, billTypeId, isActive }] }
 * Note: GET_BILLERS uses camelCase (unlike GET_BILLERS_BY_TYPE which uses PascalCase).
 */
export async function getBillTypes(): Promise<Biller[]> {
  const response = await kudaRequest<{
    billers?: Array<{
      id: string;
      name: string;
      description: string;
      billerIconUrl?: string;
      billTypeId: string;
      isActive?: boolean;
    }>;
  }>(KudaServiceType.GET_BILLERS);

  const rawBillers = response.data?.billers || [];
  return rawBillers.map((raw) => ({
    billerId: raw.id,
    billerName: raw.name,
    billerType: raw.description,
    categoryId: raw.billTypeId,
    categoryName: '',
    billerIconUrl: raw.billerIconUrl,
  }));
}

/**
 * Get billers by type (e.g., all electricity providers).
 *
 * Kuda returns camelCase fields: { billers: [{ id, name, description, ... }] }.
 * We normalize to our Biller interface.
 */
export async function getBillersByType(
  billTypeName: string
): Promise<Biller[]> {
  const response = await kudaRequest<{
    billers?: Array<{
      id: string;
      name: string;
      description: string;
      billerIconUrl?: string;
      billTypeId: string;
      billItems?: unknown[];
    }>;
    Billers?: KudaRawBiller[];
  }>(KudaServiceType.GET_BILLERS_BY_TYPE, { BillTypeName: billTypeName });

  // Handle both camelCase (production) and PascalCase (legacy/test) responses
  const camelBillers = response.data?.billers;
  if (camelBillers && camelBillers.length > 0) {
    return camelBillers.map((raw) => ({
      billerId: raw.id,
      billerName: raw.name,
      billerType: raw.description,
      categoryId: raw.billTypeId,
      categoryName: billTypeName,
      billerIconUrl: raw.billerIconUrl,
      billItems: mapBillItems(raw.billItems),
    }));
  }

  const pascalBillers = response.data?.Billers;
  if (pascalBillers && pascalBillers.length > 0) {
    return pascalBillers.map((raw) => mapKudaBiller(raw, billTypeName));
  }

  return [];
}

/**
 * Get airtime providers
 */
export function getAirtimeProviders(): Promise<Biller[]> {
  return getBillersByType('Airtime');
}

/**
 * Get data providers
 */
export function getDataProviders(): Promise<Biller[]> {
  return getBillersByType('Internet Data');
}

/**
 * Verify a customer before bill purchase.
 *
 * Kuda verify response (from docs):
 * { data: { StatusCode, Status, Message }, Data: { CustomerName } }
 * The outer envelope is normalized by kudaRequest. The customer name
 * may appear as `CustomerName` (PascalCase) in the data payload.
 */
export async function verifyBillCustomer(
  kudaBillItemIdentifier: string,
  customerIdentification: string
): Promise<{
  verified: boolean;
  customerName?: string;
  // Kuda's verify response does not include an address today; kept optional so
  // the cross-provider verify result shape is uniform.
  address?: string;
  message: string;
}> {
  try {
    const response = await kudaRequest<{
      CustomerName?: string;
      customerName?: string;
    }>(KudaServiceType.VERIFY_BILL_CUSTOMER, {
      KudaBillItemIdentifier: kudaBillItemIdentifier,
      CustomerIdentification: customerIdentification,
    });

    const customerName =
      response.data?.CustomerName ?? response.data?.customerName;

    return {
      verified: response.status && !!customerName,
      customerName,
      message: response.message,
    };
  } catch (error) {
    return {
      verified: false,
      message: error instanceof Error ? error.message : 'Verification failed',
    };
  }
}

/**
 * Purchase airtime using the primary (admin) account.
 * @param customerName - Customer's name for the Kuda transaction record.
 */
export async function purchaseAirtime(
  phoneNumber: string,
  amount: number,
  networkProvider: NetworkProvider,
  customerName: string = 'Customer',
  requestRef?: string
): Promise<PurchaseResult> {
  const reference = requestRef || generateRequestRef();

  // Map network provider to Kuda VTU identifier
  // These identifiers are from the Kuda API response
  const billItemIdentifiers: Record<NetworkProvider, string> = {
    [NetworkProvider.MTN]: 'KD-VTU-MTNNG',
    [NetworkProvider.AIRTEL]: 'KD-VTU-ATNG',
    [NetworkProvider.GLO]: 'KD-VTU-GLNG',
    [NetworkProvider.MOBILE_9]: 'KD-VTU-9NG',
  };

  const billItemIdentifier = billItemIdentifiers[networkProvider];

  if (!billItemIdentifier) {
    return {
      success: false,
      reference,
      message: `Invalid network provider: ${networkProvider}`,
      status: 'failed',
      amount,
      phoneNumber,
      provider: networkProvider,
    };
  }

  try {
    const response = await kudaRequest<
      KudaTransactionStatusData & { reference?: string; Reference?: string }
    >(
      KudaServiceType.ADMIN_PURCHASE_BILL,
      {
        CustomerFirstName: customerName,
        CustomerIdentifier: phoneNumber,
        PhoneNumber: phoneNumber,
        BillItemIdentifier: billItemIdentifier,
        Amount: Math.round(amount * 100).toString(), // Naira → Kobo
        trackingReference: reference,
      },
      reference
    );

    const vendSucceeded = isKudaVendSuccessful(response.status, response.data);
    const pin = extractKudaVoucherPin(response.data);
    const transactionId = extractKudaTransactionId(response.data, reference);

    return {
      success: vendSucceeded,
      reference,
      transactionId,
      ...(pin && { pin }),
      message: vendSucceeded
        ? response.message
        : buildKudaVendMessage(response.message, response.data),
      status: vendSucceeded ? 'successful' : 'failed',
      amount,
      phoneNumber,
      provider: networkProvider,
    };
  } catch (error) {
    return {
      success: false,
      reference,
      message: error instanceof Error ? error.message : 'Purchase failed',
      status: 'failed',
      amount,
      phoneNumber,
      provider: networkProvider,
    };
  }
}

/**
 * Purchase data bundle.
 * @param customerName - Customer's name for the Kuda transaction record.
 */
export async function purchaseData(
  phoneNumber: string,
  dataPlanCode: string,
  amount: number,
  networkProvider: NetworkProvider,
  customerName: string = 'Customer',
  requestRef?: string
): Promise<PurchaseResult> {
  const reference = requestRef || generateRequestRef();

  try {
    const response = await kudaRequest<
      KudaTransactionStatusData & { reference?: string; Reference?: string }
    >(
      KudaServiceType.ADMIN_PURCHASE_BILL,
      {
        CustomerFirstName: customerName,
        CustomerIdentifier: phoneNumber,
        PhoneNumber: phoneNumber,
        BillItemIdentifier: dataPlanCode,
        Amount: Math.round(amount * 100).toString(), // Naira → Kobo
        trackingReference: reference,
      },
      reference
    );

    const vendSucceeded = isKudaVendSuccessful(response.status, response.data);
    const pin = extractKudaVoucherPin(response.data);
    const transactionId = extractKudaTransactionId(response.data, reference);

    return {
      success: vendSucceeded,
      reference,
      transactionId,
      ...(pin && { pin }),
      message: vendSucceeded
        ? response.message
        : buildKudaVendMessage(response.message, response.data),
      status: vendSucceeded ? 'successful' : 'failed',
      amount,
      phoneNumber,
      provider: networkProvider,
    };
  } catch (error) {
    return {
      success: false,
      reference,
      message: error instanceof Error ? error.message : 'Purchase failed',
      status: 'failed',
      amount,
      phoneNumber,
      provider: networkProvider,
    };
  }
}

/**
 * Check transaction status (BILL_TSQ).
 *
 * Kuda docs: pass EITHER BillResponseReference OR BillRequestRef, not both.
 * Prefer BillResponseReference when available.
 *
 * Kuda returns: { finalStatus, transactionStatus, postingStatus, pin, ... }
 */
export async function checkTransactionStatus(
  billResponseReference?: string,
  billRequestRef?: string
): Promise<KudaTransactionStatusResult> {
  if (!billResponseReference && !billRequestRef) {
    return { status: 'failed', message: 'No reference provided' };
  }

  const statusQueries: Record<string, unknown>[] = [];
  if (billResponseReference) {
    statusQueries.push({ BillResponseReference: billResponseReference });
  }
  if (billRequestRef) {
    statusQueries.push({ BillRequestRef: billRequestRef });
  }

  let message = '';
  let status = 'unknown';
  const queryErrors: unknown[] = [];
  let querySucceeded = false;

  for (const data of statusQueries) {
    let response: KudaApiResponse<KudaTransactionStatusData>;
    try {
      response = await kudaRequest<KudaTransactionStatusData>(
        KudaServiceType.BILL_TSQ,
        data
      );
    } catch (error) {
      queryErrors.push(error);
      continue;
    }

    const nextStatus = extractKudaStatus(response.data);
    const bestStatus = getBestKudaStatus(status, nextStatus);
    querySucceeded = true;
    if (bestStatus !== status) {
      status = bestStatus;
      message = response.message || message;
    } else if (!message) {
      message = response.message || message;
    }

    const pin = extractKudaVoucherPin(response.data);
    if (pin) {
      status = 'successful';
      return {
        message: response.message || message,
        pin,
        status,
      };
    }
  }

  if (!querySucceeded && queryErrors.length > 0) {
    throw new AggregateError(
      queryErrors,
      'All Kuda transaction status queries failed'
    );
  }

  return { status, message };
}

/**
 * Get purchased bills history.
 *
 * Kuda returns: { billPayments: [...] }
 */
export async function getPurchasedBills(): Promise<{
  bills: unknown[];
}> {
  const response = await kudaRequest<{
    billPayments?: unknown[];
  }>(KudaServiceType.ADMIN_GET_PURCHASED_BILLS, {});

  return {
    bills: response.data?.billPayments || [],
  };
}

// ============================================
// ACCOUNT SERVICES
// ============================================

/**
 * Get main account balance
 */
export async function getAccountBalance(): Promise<{
  availableBalance: number;
  ledgerBalance: number;
}> {
  const response = await kudaRequest<{
    availableBalance: number;
    ledgerBalance: number;
  }>(KudaServiceType.ADMIN_MAIN_ACCOUNT_BALANCE);

  return {
    availableBalance: response.data?.availableBalance || 0,
    ledgerBalance: response.data?.ledgerBalance || 0,
  };
}

// ============================================
// TRANSFER / PAYOUT SERVICES
// ============================================

export interface Bank {
  bankCode: string;
  bankName: string;
}

export interface NameEnquiryResult {
  beneficiaryAccountNumber: string;
  beneficiaryName: string;
  senderAccountNumber: string;
  senderName: string;
  beneficiaryCustomerID: number;
  beneficiaryBankCode: string;
  nameEnquiryID: number;
  responseCode: string;
  transferCharge: number;
  sessionID: string;
}

export interface TransferResult {
  success: boolean;
  reference: string;
  transactionId?: string;
  message: string;
  status: 'pending' | 'successful' | 'failed';
  amount: number;
}

/**
 * Get list of Nigerian banks
 */
export async function getBankList(): Promise<Bank[]> {
  const response = await kudaRequest<{ banks: Bank[] }>(
    KudaServiceType.BANK_LIST
  );
  return response.data?.banks || [];
}

/**
 * Verify bank account (Name Enquiry)
 * Required before making a transfer
 */
export async function verifyBankAccount(
  beneficiaryAccountNumber: string,
  beneficiaryBankCode: string
): Promise<{
  verified: boolean;
  accountName?: string;
  sessionId?: string;
  error?: string;
}> {
  try {
    const response = await kudaRequest<NameEnquiryResult>(
      KudaServiceType.NAME_ENQUIRY,
      {
        BeneficiaryAccountNumber: beneficiaryAccountNumber,
        BeneficiaryBankCode: beneficiaryBankCode,
      }
    );

    if (response.status && response.data?.beneficiaryName) {
      return {
        verified: true,
        accountName: response.data.beneficiaryName,
        sessionId: response.data.sessionID,
      };
    }

    return {
      verified: false,
      error: response.message || 'Account verification failed',
    };
  } catch (error) {
    return {
      verified: false,
      error: error instanceof Error ? error.message : 'Verification failed',
    };
  }
}

/**
 * Transfer funds to a bank account
 * Use this to pay out merchants their commission share
 */
export async function transferFunds(
  amount: number,
  beneficiaryAccountNumber: string,
  beneficiaryBankCode: string,
  beneficiaryName: string,
  narration: string,
  nameEnquirySessionId?: string
): Promise<TransferResult> {
  const requestRef = generateRequestRef();

  try {
    // If no session ID provided, do name enquiry first
    let sessionId = nameEnquirySessionId;
    if (!sessionId) {
      const verification = await verifyBankAccount(
        beneficiaryAccountNumber,
        beneficiaryBankCode
      );
      if (!verification.verified) {
        return {
          success: false,
          reference: requestRef,
          message: verification.error || 'Account verification failed',
          status: 'failed',
          amount,
        };
      }
      sessionId = verification.sessionId;
    }

    const response = await kudaRequest<{
      transactionReference: string;
      requestReference: string;
    }>(
      KudaServiceType.SINGLE_FUND_TRANSFER,
      {
        ClientAccountNumber: '', // Uses main account
        BeneficiaryAccount: beneficiaryAccountNumber,
        BeneficiaryBankCode: beneficiaryBankCode,
        BeneficiaryName: beneficiaryName,
        Amount: amount.toString(),
        Narration: narration,
        NameEnquirySessionID: sessionId,
        SenderName: 'Baci',
        ClientFeeCharge: 0,
      },
      requestRef
    );

    return {
      success: response.status,
      reference: requestRef,
      transactionId: response.data?.transactionReference,
      message: response.message,
      status: response.status ? 'successful' : 'failed',
      amount,
    };
  } catch (error) {
    return {
      success: false,
      reference: requestRef,
      message: error instanceof Error ? error.message : 'Transfer failed',
      status: 'failed',
      amount,
    };
  }
}

/**
 * Pay out merchant commission
 * Transfers accumulated VTU commission to merchant's bank account
 */
export function payoutMerchantCommission(
  merchantBankDetails: {
    accountNumber: string;
    bankCode: string;
    accountName: string;
  },
  amount: number,
  merchantId: string
): Promise<TransferResult> {
  const narration = `Baci VTU Commission Payout - ${merchantId.slice(0, 8)}`;

  return transferFunds(
    amount,
    merchantBankDetails.accountNumber,
    merchantBankDetails.bankCode,
    merchantBankDetails.accountName,
    narration
  );
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Format phone number for Kuda API
 */
export function formatPhoneNumber(phoneNumber: string): string {
  // Remove all non-digit characters
  let cleaned = phoneNumber.replace(/\D/g, '');

  // Convert international format to local
  if (cleaned.startsWith('234')) {
    cleaned = `0${cleaned.substring(3)}`;
  }

  // Ensure it starts with 0
  if (!cleaned.startsWith('0') && cleaned.length === 10) {
    cleaned = `0${cleaned}`;
  }

  return cleaned;
}

/**
 * Validate phone number
 */
export function isValidPhoneNumber(phoneNumber: string): boolean {
  const formatted = formatPhoneNumber(phoneNumber);
  return /^0[789][01]\d{8}$/.test(formatted);
}

/**
 * Get airtime denominations for quick purchase
 */
export function getAirtimeDenominations(): number[] {
  return [100, 200, 500, 1000, 2000, 5000];
}

export const KUDA_COMMISSION_RATES = VTU_COMMISSION_RATES;

/**
 * Get commission rate for a provider
 * @deprecated Use the centralized Commerce Brain Edge Function instead.
 * This function is kept for backward compatibility but will be removed in a future version.
 * Use calculateCommerce('calculate_vtu', {...}) from @/lib/supabase/client
 */
export function getCommissionRate(
  provider: string,
  category: VtuCommissionCategory = 'AIRTIME'
): { rate: number; cap?: number } {
  return getKudaVtuCommissionRate(provider, category);
}

/**
 * Calculate platform commission on VTU
 *
 * Commission split:
 * - Merchant gets 50% of Kuda commission
 * - Platform (Baci) gets 50% of Kuda commission
 *
 * Example: ₦1,000 MTN airtime (3% = ₦30 commission)
 * - Merchant earns: ₦15
 * - Platform earns: ₦15
 *
 * @deprecated Use the centralized Commerce Brain Edge Function instead.
 * This function is kept for backward compatibility but will be removed in a future version.
 * Use calculateCommerce('calculate_vtu', {...}) from @/lib/supabase/client
 */
export function calculateVTUCommission(
  amount: number,
  provider: NetworkProvider | string,
  category: VtuCommissionCategory = 'AIRTIME',
  merchantSplitPercentage: number = 50 // Merchant gets 50% of commission by default
): {
  platformEarning: number;
  merchantEarning: number;
  totalCommission: number;
  commissionRate: number;
} {
  const { rate, cap } = getCommissionRate(provider, category);

  // Calculate total commission from Kuda
  let totalCommission = amount * rate;

  // Apply cap if exists
  if (cap && totalCommission > cap) {
    totalCommission = cap;
  }

  // Split between merchant and platform
  const merchantEarning = totalCommission * (merchantSplitPercentage / 100);
  const platformEarning = totalCommission - merchantEarning;

  return {
    platformEarning: Math.round(platformEarning * 100) / 100,
    merchantEarning: Math.round(merchantEarning * 100) / 100,
    totalCommission: Math.round(totalCommission * 100) / 100,
    commissionRate: rate * 100, // Return as percentage
  };
}
