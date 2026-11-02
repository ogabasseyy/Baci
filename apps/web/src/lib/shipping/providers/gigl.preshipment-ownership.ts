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
// 'owned' and 'not_owned' are GIG's definite answers: 'not_owned' needs a
// record for the waybill that names a different account. 'unavailable'
// means GIG gave no usable answer (timeout, HTTP or envelope failure, login
// problem, or no record for the waybill). The worker then applies the
// cancellation unattested, so the database refunds nothing until a later
// poll attests it.
export type GiglWaybillOwnership = 'owned' | 'not_owned' | 'unavailable';

const preshipmentRecord = z
  .object({
    Waybill: z.union([z.string(), z.number()]),
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
// 'none' means GIG returned no record for the waybill at all, which is not
// an answer about ownership.
function classifyRecords(
  records: readonly unknown[],
  waybill: string,
  accountCode: string
): 'owned' | 'not_owned' | 'none' | 'unreadable' {
  let owned = 0;
  for (const entry of records) {
    const parsed = preshipmentRecord.safeParse(entry);
    // Fail closed: an entry whose waybill cannot be read might be this
    // waybill's record, so it must never be skipped on the way to 'owned'.
    if (!parsed.success) return 'unreadable';
    if (String(parsed.data.Waybill).trim() !== waybill) continue;
    const owner = (parsed.data as { CustomerCode?: unknown }).CustomerCode;
    if (typeof owner !== 'string' || owner.trim() !== accountCode) {
      return 'not_owned';
    }
    owned += 1;
  }
  return owned > 0 ? 'owned' : 'none';
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
 * to the GIG account Baci is logged in as, 'not_owned' when a record for it
 * names another account, and 'unavailable' when GIG cannot answer (failure,
 * timeout, oversized or failure response, or no record for the waybill). Logs carry codes and HTTP status only,
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
    const verdict =
      records === null
        ? 'none'
        : classifyRecords(records, normalizedWaybill, accountCode);
    if (verdict === 'owned') return 'owned';
    if (verdict === 'none' || verdict === 'unreadable') {
      io.log('warn', 'GIGL preshipment ownership check failed', {
        code:
          verdict === 'none'
            ? 'gigl_preshipment_no_record'
            : 'gigl_preshipment_unreadable_record',
      });
      return 'unavailable';
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
