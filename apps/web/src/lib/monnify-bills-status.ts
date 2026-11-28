const MONNIFY_SUCCESS_STATUSES = new Set([
  'PAID',
  'SUCCESS',
  'SUCCESSFUL',
  'COMPLETED',
]);
const MONNIFY_PROCESSING_STATUSES = new Set([
  'PENDING',
  'IN_PROGRESS',
  'PROCESSING',
]);
const MONNIFY_FAILED_STATUSES = new Set(['FAILED', 'FAILURE', 'UNSUCCESSFUL']);

function normalizeMonnifyStatus(status: string | null | undefined) {
  const normalized = status?.trim().toUpperCase();
  return normalized || undefined;
}

/**
 * Classifies the delivery state of a bill, treating an in-progress vend as
 * authoritative even when Monnify has already captured payment.
 */
export function classifyMonnifyBillStatus(body: {
  status?: string | null;
  vendStatus?: string | null;
}) {
  const paymentStatus = normalizeMonnifyStatus(body.status);
  const vendStatus = normalizeMonnifyStatus(body.vendStatus);
  const isProcessing =
    (!!vendStatus && MONNIFY_PROCESSING_STATUSES.has(vendStatus)) ||
    (!!paymentStatus && MONNIFY_PROCESSING_STATUSES.has(paymentStatus));
  const terminalStatus = vendStatus ?? paymentStatus;
  const isSuccess =
    !isProcessing &&
    !!terminalStatus &&
    MONNIFY_SUCCESS_STATUSES.has(terminalStatus);
  const isFailed =
    !isProcessing &&
    !!terminalStatus &&
    MONNIFY_FAILED_STATUSES.has(terminalStatus);
  return { isSuccess, isProcessing, isFailed };
}

/** Values a biller sends when there is no token ("0", "-", "N/A", "null"...). */
const PLACEHOLDER_TOKEN =
  /^(?:0+|[-.\s_*#]+|x+|n\/?a|na|null|none|nil|undefined|tbd|notavailable|notoken|notapplicable|notissued|notgenerated|nottoken|false|true|nan|empty|blank|void|pending|processing|failed|failure|error|invalid|unavailable|unknown|test|dummy|token)$/i;

/** "0000-0000", "XXXX XXXX", "---": placeholders written with separators. */
function isPlaceholderToken(value: string): boolean {
  if (PLACEHOLDER_TOKEN.test(value)) {
    return true;
  }
  const compact = value.replace(/[\s\-._*#/]/g, '');
  return (
    compact === '' ||
    /^(?:0+|x+)$/i.test(compact) ||
    // "N / A", "-- pending --": the vocabulary again, without separators.
    PLACEHOLDER_TOKEN.test(compact)
  );
}

/**
 * The delivered token: the first non-blank of metaData.token / token, trimmed.
 * A whitespace-only token is not a delivery (it would settle a row with no
 * voucher), and must not shadow a valid flat token.
 */
export function readMonnifyBillToken(body: {
  token?: string | null;
  metaData?: { token?: string | null } | null;
}): string | undefined {
  return (
    [body.metaData?.token, body.token]
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .find((value) => value !== '' && !isPlaceholderToken(value)) || undefined
  );
}

/**
 * The status pair classifyMonnifyBillStatus reads: `transactionStatus` stands
 * in for a missing or blank `vendStatus`, so a body that only carries it is
 * not mistaken for a body with no state.
 */
export function toBillStatusInput(body: {
  status?: string | null;
  vendStatus?: string | null;
  transactionStatus?: string | null;
  finalStatus?: string | null;
}) {
  return {
    status: body.status,
    vendStatus: [
      body.vendStatus,
      body.transactionStatus,
      body.finalStatus,
    ].find((value) => !!value?.trim()),
  };
}

/**
 * Vend-level states (`vendStatus`, `transactionStatus`, `finalStatus`) where
 * one says failed and another does not: neither has authority, so the answer proves nothing
 * and must be held, not refunded and not settled.
 */
export function hasConflictingVendStatuses(body: {
  vendStatus?: string | null;
  transactionStatus?: string | null;
  finalStatus?: string | null;
}): boolean {
  const categories = new Set(
    [body.vendStatus, body.transactionStatus, body.finalStatus]
      .map((value) => value?.trim())
      .filter((value): value is string => !!value)
      .map((value) => {
        const state = classifyMonnifyBillStatus({ vendStatus: value });
        if (state.isSuccess) {
          return 'success';
        }
        if (state.isFailed) {
          return 'failed';
        }
        return state.isProcessing ? 'processing' : 'unknown';
      })
  );
  // Peer vend states that name different outcomes (success beside pending,
  // failed beside anything else): none has authority, so the answer is held.
  return categories.size > 1;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** The value under a key, ignoring case and "_" / "-" spelling. */
function readKey(record: Record<string, unknown>, wanted: string): unknown {
  for (const [key, value] of Object.entries(record)) {
    if (key.replace(/[\s_-]/g, '').toLowerCase() === wanted) {
      return value;
    }
  }
  return undefined;
}

/**
 * The `responseBody` objects of an answer: the answer's own, or those of a
 * parsed form-encoded answer (an array of one-pair objects). Nothing deeper
 * is searched, so a credential token under some other object never counts.
 */
function responseBodies(answer: unknown): Record<string, unknown>[] {
  const roots = Array.isArray(answer) ? answer : [answer];
  return roots.flatMap((root) => {
    const record = asRecord(root);
    const body = record ? readKey(record, 'responsebody') : undefined;
    return (Array.isArray(body) ? body : [body])
      .map(asRecord)
      .filter((item): item is Record<string, unknown> => item !== null);
  });
}

/**
 * Whether an answer's responseBody carries a real (non-placeholder) voucher
 * token where a vend puts it: `responseBody.token` or
 * `responseBody.metaData.token`, in JSON or in a parsed form-encoded shape.
 */
export function hasBodyToken(answer: unknown): boolean {
  return responseBodies(answer).some((body) => {
    const metaData = asRecord(readKey(body, 'metadata'));
    const direct = readKey(body, 'token');
    const nested = metaData ? readKey(metaData, 'token') : undefined;
    return !!readMonnifyBillToken({
      token: typeof direct === 'string' ? direct : undefined,
      metaData: { token: typeof nested === 'string' ? nested : undefined },
    });
  });
}

/**
 * A fresh vend Monnify plainly DECLINED: the vend-level state is exactly
 * DECLINED (or REJECTED), with no token and no Monnify reference to requery.
 * Such an answer is a refusal (refunded, never sent to another provider); on a
 * requery the same word proves nothing and stays held.
 */
export function isMonnifyPlainFreshDecline(
  body: {
    status?: string | null;
    vendStatus?: string | null;
    transactionStatus?: string | null;
    finalStatus?: string | null;
  },
  hasReferenceOrToken: boolean
): boolean {
  const input = toBillStatusInput(body);
  const state = normalizeMonnifyStatus(input.vendStatus ?? input.status);
  return !hasReferenceOrToken && (state === 'DECLINED' || state === 'REJECTED');
}
