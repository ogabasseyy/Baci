const MONNIFY_SUCCESS_STATUSES = new Set(['PAID', 'SUCCESS', 'SUCCESSFUL']);
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
  /^(?:0+|[-.\s_*#]+|x+|n\/?a|na|null|none|nil|undefined|tbd|pending|processing|failed|failure|error|invalid|unavailable|unknown|test|dummy|token)$/i;

/** "0000-0000", "XXXX XXXX", "---": placeholders written with separators. */
function isPlaceholderToken(value: string): boolean {
  if (PLACEHOLDER_TOKEN.test(value)) {
    return true;
  }
  const compact = value.replace(/[\s\-._*#/]/g, '');
  return compact === '' || /^(?:0+|x+)$/i.test(compact);
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

const TOKEN_SEARCH_DEPTH = 6;
/** A `token` under request/auth/error objects is a credential or echo, not a voucher. */
const NON_VOUCHER_PARENT =
  /^(?:request|lookup|query|requery|auth|authentication|credential|login|access|oauth|error|exception|customer|validation|refund|reversal|settlement|callback|webhook|notification|chargeback)s?$/;

function findTokenIn(
  value: unknown,
  insideBody: boolean,
  depth: number,
  parentKey = ''
): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }
  // Nesting deeper than we scan can't be cleared: fail closed (hold), like the
  // code and duplicate scans.
  if (depth > TOKEN_SEARCH_DEPTH) {
    return true;
  }
  const entries = Array.isArray(value)
    ? value.map((item) => ['', item] as const)
    : Object.entries(value);
  return entries.some(([rawKey, child]) => {
    const key = rawKey.replace(/[\s_-]/g, '').toLowerCase();
    if (
      insideBody &&
      key === 'token' &&
      typeof child === 'string' &&
      !NON_VOUCHER_PARENT.test(parentKey)
    ) {
      if (readMonnifyBillToken({ token: child })) {
        return true;
      }
    }
    return findTokenIn(
      child,
      insideBody || key === 'responsebody',
      depth + 1,
      key
    );
  });
}

/**
 * Whether an answer's responseBody carries a real (non-placeholder) token, in
 * JSON or in a parsed form-encoded shape (nested objects or one-pair arrays).
 */
export function hasBodyToken(answer: unknown): boolean {
  return findTokenIn(answer, false, 0);
}
