import { createHmac } from 'node:crypto';
import type { ImeiDeviceCategory, ImeiServiceTierKey } from '@baci/shared/imei';
import { NextResponse } from 'next/server';
import type { ImeiAccessClient } from '@/lib/imei-access';
import type {
  ImeiLookupErrorBody,
  ImeiLookupResponseBody,
} from '@/lib/imei-lookup-fulfillment';

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ImeiLookupStatus =
  | 'completed'
  | 'failed_error'
  | 'pending'
  | 'pending_provider'
  | 'provider_submitting'
  | 'refunded_error'
  | 'refunded_not_found'
  | 'refund_pending'
  | 'submission_unknown'
  | 'wallet_rejected';

export interface ImeiLookupRow {
  amount_ngn: number | string;
  cached_response: ImeiLookupResponseBody | null;
  cached_status: number | null;
  customer_id: string;
  device_category?: ImeiDeviceCategory | null;
  id: string;
  imei_hash: string;
  merchant_id: string;
  status: ImeiLookupStatus;
  tier: ImeiServiceTierKey;
}

interface LookupContext {
  customerId: string;
  deviceCategory?: ImeiDeviceCategory;
  imeiHash: string;
  merchantId: string;
  tier: ImeiServiceTierKey;
}

function isPetrockPendingStatus(status: ImeiLookupStatus) {
  return (
    status === 'provider_submitting' ||
    status === 'pending_provider' ||
    status === 'submission_unknown'
  );
}

function pendingReplay(row: ImeiLookupRow) {
  return NextResponse.json(
    {
      lookupId: row.id,
      pollAfterMs: 2000,
      status: 'pending',
      success: true,
    },
    { status: 202 }
  );
}

export function errorBody({
  balance,
  code,
  error,
  required,
}: {
  balance?: number;
  code: string;
  error: string;
  required?: number;
}): ImeiLookupErrorBody {
  return {
    ...(balance !== undefined ? { balance } : {}),
    code,
    error,
    ...(required !== undefined ? { required } : {}),
    status: 'error',
    success: false,
  };
}

export function json(body: ImeiLookupResponseBody, status: number) {
  return NextResponse.json(body, { status });
}

export function hashImei(imei: string, salt: string) {
  return createHmac('sha256', salt).update(imei).digest('hex');
}

export function isValidImeiChecksum(imei: string): boolean {
  if (!/^\d{15}$/.test(imei)) {
    return false;
  }

  let sum = 0;
  for (let i = 0; i < imei.length; i++) {
    let digit = Number.parseInt(imei[i], 10);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) {
        digit = Math.floor(digit / 10) + (digit % 10);
      }
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

export function isUniqueViolation(error: { code?: string } | null) {
  return error?.code === '23505';
}

export function mapExistingLookup(row: ImeiLookupRow, context: LookupContext) {
  if (
    row.customer_id !== context.customerId ||
    row.merchant_id !== context.merchantId
  ) {
    return json(
      errorBody({
        code: 'IDEMPOTENCY_CONFLICT',
        error: 'Idempotency-Key already belongs to another request.',
      }),
      409
    );
  }

  if (
    row.tier !== context.tier ||
    row.imei_hash !== context.imeiHash ||
    (row.device_category ?? null) !== (context.deviceCategory ?? null)
  ) {
    return json(
      errorBody({
        code: 'IDEMPOTENCY_CONFLICT',
        error: 'Idempotency-Key already used with a different request.',
      }),
      409
    );
  }

  if (row.status === 'pending') {
    return json(
      errorBody({
        code: 'IDEMPOTENT_REQUEST_IN_FLIGHT',
        error: 'This IMEI lookup is still processing.',
      }),
      409
    );
  }

  if (isPetrockPendingStatus(row.status)) return pendingReplay(row);

  if (row.cached_response && row.cached_status) {
    return json(
      { ...row.cached_response, lookupId: row.id },
      row.cached_status
    );
  }

  return json(
    errorBody({
      code: 'IDEMPOTENCY_CONFLICT',
      error: 'Idempotency-Key has no replayable terminal response.',
    }),
    409
  );
}

export function mapExistingTerminalLookupWithoutImeiHash(
  row: ImeiLookupRow,
  context: Omit<LookupContext, 'imeiHash'>
) {
  if (
    row.customer_id !== context.customerId ||
    row.merchant_id !== context.merchantId
  ) {
    return json(
      errorBody({
        code: 'IDEMPOTENCY_CONFLICT',
        error: 'Idempotency-Key already belongs to another request.',
      }),
      409
    );
  }

  if (row.tier !== context.tier) {
    return json(
      errorBody({
        code: 'IDEMPOTENCY_CONFLICT',
        error: 'Idempotency-Key already used with a different request.',
      }),
      409
    );
  }

  if (row.status === 'pending') {
    return json(
      errorBody({
        code: 'IDEMPOTENT_REQUEST_IN_FLIGHT',
        error: 'This IMEI lookup is still processing.',
      }),
      409
    );
  }

  if (isPetrockPendingStatus(row.status)) return pendingReplay(row);

  if (row.cached_response && row.cached_status) {
    return json(
      { ...row.cached_response, lookupId: row.id },
      row.cached_status
    );
  }

  return json(
    errorBody({
      code: 'IDEMPOTENCY_CONFLICT',
      error: 'Idempotency-Key has no replayable terminal response.',
    }),
    409
  );
}

export async function findLookupByIdempotencyKey(
  supabase: ImeiAccessClient,
  idempotencyKey: string
) {
  const { data, error } = await supabase.readReplay(idempotencyKey);

  if (error) {
    throw new Error(`Failed to read IMEI idempotency row: ${error.message}`);
  }

  return data as ImeiLookupRow | null;
}
