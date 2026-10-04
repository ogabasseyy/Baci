import {
  pendingSavingsReceiptsSchema,
  savingsNotificationExpoReceiptsEndpointSchema,
  savingsNotificationWorkerLimitSchema,
} from '@/schemas/savings-notification-worker';

const EXPO_RECEIPTS_ENDPOINT =
  savingsNotificationExpoReceiptsEndpointSchema.parse(
    'https://exp.host/--/api/v2/push/getReceipts'
  );
const EXPO_RECEIPTS_TIMEOUT_MS = 8_000;
const KNOWN_EXPO_RECEIPT_ERRORS = new Set([
  'DeviceNotRegistered',
  'MessageTooBig',
  'MessageRateExceeded',
  'MismatchSenderId',
  'InvalidCredentials',
]);

export type SavingsReceiptStatus = 'provider_confirmed' | 'receipt_failed';

export type SavingsReceiptReconciliationCounts = {
  checked: number;
  providerConfirmed: number;
  receiptFailed: number;
  pending: number;
  recordFailed: number;
};

type ReceiptReconciliationDependencies = {
  pendingReceipts: (limit: number) => Promise<unknown>;
  recordReceipt: (
    ticketId: string,
    status: SavingsReceiptStatus,
    error: string | null
  ) => Promise<boolean>;
};

type ReceiptReconciliationOptions = {
  limit: unknown;
  accessToken?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function knownReceiptError(value: unknown): string | null {
  if (typeof value !== 'string' || !KNOWN_EXPO_RECEIPT_ERRORS.has(value)) {
    return null;
  }
  return value;
}

export async function reconcileSavingsNotificationReceipts(
  dependencies: ReceiptReconciliationDependencies,
  options: ReceiptReconciliationOptions
): Promise<SavingsReceiptReconciliationCounts> {
  const limit = savingsNotificationWorkerLimitSchema.parse(options.limit);
  const rawRows = await dependencies.pendingReceipts(limit);
  const parsedRows = pendingSavingsReceiptsSchema.safeParse(rawRows);
  if (!parsedRows.success) {
    throw new Error(
      'Savings notification worker received invalid receipt rows'
    );
  }
  const rows = parsedRows.data;
  const counts: SavingsReceiptReconciliationCounts = {
    checked: rows.length,
    providerConfirmed: 0,
    receiptFailed: 0,
    pending: 0,
    recordFailed: 0,
  };
  if (rows.length === 0) return counts;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (options.accessToken)
    headers.Authorization = `Bearer ${options.accessToken}`;

  let payload: unknown;
  try {
    const response = await fetch(EXPO_RECEIPTS_ENDPOINT, {
      method: 'POST',
      headers,
      redirect: 'error',
      body: JSON.stringify({ ids: rows.map((row) => row.ticket_id) }),
      signal: AbortSignal.timeout(EXPO_RECEIPTS_TIMEOUT_MS),
    });
    if (!response.ok) {
      counts.pending = rows.length;
      return counts;
    }
    payload = await response.json();
  } catch {
    counts.pending = rows.length;
    return counts;
  }

  if (!isRecord(payload) || !isRecord(payload.data)) {
    counts.pending = rows.length;
    return counts;
  }

  for (const row of rows) {
    const receipt = payload.data[row.ticket_id];
    if (
      !isRecord(receipt) ||
      (receipt.status !== 'ok' && receipt.status !== 'error')
    ) {
      counts.pending += 1;
      continue;
    }
    const error =
      receipt.status === 'error' && isRecord(receipt.details)
        ? knownReceiptError(receipt.details.error)
        : null;
    // Expo asks that per-device rate limiting be retried slowly: leaving
    // the ticket unrecorded keeps it pending for a later run instead of
    // finalizing a temporary limit as a permanent failure.
    if (receipt.status === 'error' && error === 'MessageRateExceeded') {
      counts.pending += 1;
      continue;
    }
    const status: SavingsReceiptStatus =
      receipt.status === 'ok' ? 'provider_confirmed' : 'receipt_failed';
    try {
      const recorded = await dependencies.recordReceipt(
        row.ticket_id,
        status,
        error
      );
      if (!recorded) {
        counts.recordFailed += 1;
        counts.pending += 1;
        continue;
      }
      counts[
        status === 'provider_confirmed' ? 'providerConfirmed' : 'receiptFailed'
      ] += 1;
    } catch {
      counts.recordFailed += 1;
      counts.pending += 1;
    }
  }

  return counts;
}
