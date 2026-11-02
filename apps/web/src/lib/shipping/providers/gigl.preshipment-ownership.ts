import { z } from 'zod';
import type { GiglApiClient } from './gigl.auth';
import {
  GIGL_PRESHIPMENT_MAX_RECORDS,
  GIGL_PRESHIPMENT_RESPONSE_MAX_BYTES,
  GIGL_TRACKING_TIMEOUT_MS,
  GIGL_TRACKING_WAYBILL_MAX_LENGTH,
  type GiglProviderIo,
  isGiglAbortError,
} from './gigl.constants';

// GIG's third-party API answers GET /get/preshipment for waybills of any
// GIG account, but each record names its owner in CustomerCode. Only
// waybills booked through Baci's own GIG account carry the logged-in
// account's UserChannelCode, and merchants cannot create or cancel
// waybills there. The tracking worker uses this to attest a GIG
// cancellation before the database refunds a merchant-wallet charge.
//
// 'owned' and 'not_owned' are GIG's definite answers. 'unavailable' means
// GIG could not answer (timeout, HTTP or envelope failure, login problem):
// the worker then retries the poll instead of applying the cancellation
// unattested, so a transient GIG error never decides a refund.
export type GiglWaybillOwnership = 'owned' | 'not_owned' | 'unavailable';

const preshipmentRecord = z
  .object({
    Waybill: z.union([z.string(), z.number()]),
    CustomerCode: z.string().nullish(),
  })
  .loose();

type PreshipmentEnvelope = {
  status: number;
  success?: boolean;
  data?: unknown;
} | null;

function toPreshipmentRecords(data: unknown): unknown[] | null {
  if (Array.isArray(data)) {
    return data.length <= GIGL_PRESHIPMENT_MAX_RECORDS ? data : null;
  }
  return data !== null && typeof data === 'object' ? [data] : null;
}

// Every record GIG returns for this exact waybill must name the account,
// and at least one must: a missing, blank or foreign owner never attests.
function isOwnedByAccount(
  records: readonly unknown[],
  waybill: string,
  accountCode: string
): boolean {
  let owned = 0;
  for (const entry of records) {
    const parsed = preshipmentRecord.safeParse(entry);
    if (!parsed.success || String(parsed.data.Waybill).trim() !== waybill) {
      continue;
    }
    if (parsed.data.CustomerCode?.trim() !== accountCode) return false;
    owned += 1;
  }
  return owned > 0;
}

function isUsableEnvelope(envelope: PreshipmentEnvelope): boolean {
  return (
    envelope !== null &&
    envelope.success !== false &&
    envelope.status >= 200 &&
    envelope.status < 300
  );
}

/**
 * Resolves 'owned' only when GIG's preshipment record for `waybill` belongs
 * to the GIG account Baci is logged in as, 'not_owned' when GIG answers with
 * anything else, and 'unavailable' when GIG cannot answer (failure, timeout,
 * oversized or failure response). Logs carry codes and HTTP status only,
 * never the waybill or the provider record.
 */
export async function attestGiglWaybillOwnership(
  apiClient: GiglApiClient,
  io: GiglProviderIo,
  waybill: string
): Promise<GiglWaybillOwnership> {
  const normalizedWaybill = waybill.trim();
  if (
    !normalizedWaybill ||
    normalizedWaybill.length > GIGL_TRACKING_WAYBILL_MAX_LENGTH
  ) {
    return 'not_owned';
  }

  const signal = AbortSignal.timeout(GIGL_TRACKING_TIMEOUT_MS);
  try {
    const tokenData = await apiClient.getApiToken(
      GIGL_TRACKING_TIMEOUT_MS,
      signal
    );
    const result = await apiClient.safeFetchEnvelopeWithAccessToken(
      `${apiClient.baseUrl}/get/preshipment?Waybill=${encodeURIComponent(normalizedWaybill)}`,
      tokenData,
      () => ({ method: 'GET', signal, timeout: GIGL_TRACKING_TIMEOUT_MS }),
      { maxResponseBytes: GIGL_PRESHIPMENT_RESPONSE_MAX_BYTES }
    );

    if (!result.response.ok) {
      await result.response.body?.cancel().catch(() => undefined);
      io.log('warn', 'GIGL preshipment ownership check failed', {
        code: 'gigl_preshipment_http_error',
        status: result.response.status,
      });
      return 'unavailable';
    }
    if (!isUsableEnvelope(result.envelope)) {
      io.log('warn', 'GIGL preshipment ownership check failed', {
        code: 'gigl_preshipment_invalid_envelope',
        status: result.envelope?.status ?? null,
      });
      return 'unavailable';
    }

    const accountCode = result.tokenData.userChannelCode.trim();
    if (accountCode === '') {
      io.log('warn', 'GIGL preshipment ownership check failed', {
        code: 'gigl_preshipment_missing_account_code',
      });
      return 'unavailable';
    }
    const records = toPreshipmentRecords(result.envelope?.data);
    if (
      records !== null &&
      isOwnedByAccount(records, normalizedWaybill, accountCode)
    ) {
      return 'owned';
    }
    io.log('warn', 'GIGL preshipment ownership not attested', {
      code: 'gigl_preshipment_not_account_owned',
    });
    return 'not_owned';
  } catch (error) {
    io.log('warn', 'GIGL preshipment ownership check failed', {
      code:
        signal.aborted || isGiglAbortError(error)
          ? 'gigl_preshipment_timeout'
          : 'gigl_preshipment_error',
    });
    return 'unavailable';
  }
}
