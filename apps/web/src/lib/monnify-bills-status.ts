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
      .find((value) => value !== '' && !PLACEHOLDER_TOKEN.test(value)) ||
    undefined
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
  const states = [body.vendStatus, body.transactionStatus, body.finalStatus]
    .map((value) => value?.trim())
    .filter((value): value is string => !!value);
  const failed = states.filter(
    (value) => classifyMonnifyBillStatus({ vendStatus: value }).isFailed
  ).length;
  // One says failed while another says anything else (success, pending, or a
  // state we do not know): neither has authority.
  return failed > 0 && failed < states.length;
}
