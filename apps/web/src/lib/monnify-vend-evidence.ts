/**
 * Keys are compared case-insensitively with "_", "-" and spaces ignored, so
 * vend_reference, VendReference and vendReference all count.
 */
function normaliseKey(key: string): string {
  return key.replace(/[\s_-]/g, '').toLowerCase();
}

/**
 * Reference-like keys: any key ending in reference / ref / reference number,
 * or a transaction, vend, order or txn id (transactionReference,
 * vendReference, paymentReference, orderReference, referenceNumber,
 * transactionId…). Matching the shape, not a fixed list, fails closed on new
 * Monnify keys: an unknown reference blocks Kuda instead of being missed.
 */
const REFERENCE_LIKE_KEY =
  /(?:reference(?:no|number|id)?|ref|(?:transaction|txn|vend|order|payment|purchase)(?:id|number|no)|(?:receipt|invoice)(?:no|number|id)?)$/;

/**
 * At the top level a bare `reference` or `requestReference` is usually an echo
 * of our own request, so only more specific references count there. Below
 * the top level (responseBody and anything nested in it) every
 * reference-like key counts.
 */
const TOP_LEVEL_ECHO_KEYS = new Set(['reference', 'requestreference']);

function isVendStatusKey(key: string): boolean {
  // A string status ("FAILED", "PENDING") is the vend's own status; a
  // numeric one is just an HTTP code and is ignored (isEvidenceValue).
  // Any key ending in "status" (finalStatus, transactionStatus, vendStatus…);
  // HTTP labels and numeric codes are filtered out by value.
  return key.endsWith(STATUS_KEY);
}

/**
 * References we supplied before the vend (validation, request or customer
 * references) are echoes, at any depth, never evidence of a vend.
 */
const ECHO_REFERENCE_PREFIX = /^(?:validation|request|customer)/;

function isVendReferenceKey(key: string): boolean {
  return REFERENCE_LIKE_KEY.test(key) && !ECHO_REFERENCE_PREFIX.test(key);
}

/**
 * Baci's own request references are 24 lowercase hex characters
 * (generateRequestRef). A top-level bare `reference` in that shape is our
 * echo; any other value (e.g. "MFBP-1") is a provider-issued reference and
 * fails closed.
 */
const OWN_REQUEST_REFERENCE = /^[0-9a-f]{24}$/i;

function hasProviderTopLevelReference(
  record: Record<string, unknown>
): boolean {
  return Object.entries(record).some(([rawKey, value]) => {
    if (normaliseKey(rawKey) !== 'reference') {
      return false;
    }
    return (
      (typeof value === 'string' &&
        value.trim() !== '' &&
        !OWN_REQUEST_REFERENCE.test(value.trim())) ||
      typeof value === 'number'
    );
  });
}

function isTopLevelEvidenceKey(key: string): boolean {
  return (
    isVendStatusKey(key) ||
    (isVendReferenceKey(key) && !TOP_LEVEL_ECHO_KEYS.has(key))
  );
}

function isNestedEvidenceKey(key: string): boolean {
  return isVendStatusKey(key) || isVendReferenceKey(key);
}

const STATUS_KEY = normaliseKey('status');
const GENERIC_STATUS_KEY = /^(?:http|response|result)?status(?:code)?$/;
/**
 * HTTP reason phrases and generic error labels that error bodies put in a
 * `status` field. Any other non-numeric status (FAILED, PENDING, CANCELLED,
 * DECLINED, UNKNOWN…) is read as the vend's own state and fails closed.
 */
export const HTTP_STATUS_LABEL =
  /^(?:errors?|ok|bad request|payment required|unauthori[sz]ed|forbidden|not found|method not allowed|not acceptable|request timeout|conflict|unprocessable entity|too many requests|internal server error|bad gateway|service unavailable|gateway timeout|invalid request|validation error)$/i;
const MAX_NESTED_DEPTH = 6;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isEvidenceValue(key: string, value: unknown): boolean {
  // A numeric `status` (number or digit string such as "400") is an HTTP
  // code, never a vend status.
  // A generic `status` counts unless it is an HTTP reason phrase or error
  // label ("error", "Bad Request"): those only label the error body.
  if (key.endsWith(STATUS_KEY)) {
    // A numeric generic status (status, httpStatus, responseStatus…) is an
    // HTTP code; a numeric vend-specific one (transactionStatus: 2) is a
    // vend state.
    if (typeof value === 'number') {
      return !GENERIC_STATUS_KEY.test(key);
    }
    if (typeof value !== 'string') {
      return false;
    }
    // A boolean-like string ("false", "null", "no") says nothing about a vend.
    if (/^\s*(?:false|null|no|n)\s*$/i.test(value)) {
      return false;
    }
    if (/^\s*\d+\s*$/.test(value)) {
      return !GENERIC_STATUS_KEY.test(key);
    }
    // "400 Bad Request" reads as its reason phrase.
    const label = value
      .replace(/[_-]+/g, ' ')
      .trim()
      .replace(/^\d{3}\s+(?=\D)/, '');
    return /\D/.test(label) && !HTTP_STATUS_LABEL.test(label);
  }
  if (typeof value === 'string') {
    return value.trim() !== '';
  }
  return typeof value === 'number';
}

/**
 * Boolean outcome flags ("processed", "isDelivered", "inProgress"…): set
 * to true they say a vend happened or is under way; false says nothing.
 */
const OUTCOME_FLAG_KEY =
  /^(?:is|was|has)?(?:been)?(?:vend|transaction|txn|purchase|payment|airtime)?(?:has)?(?:been)?(?:attempted|processed|delivered|completed|vended|successful|success|dispatched|pending|inprogress|queued|submitted|accepted|initiated|fulfilled|credited|recharged|toppedup|failed|failure|rejected|cancell?ed|reversed|declined|timedout)$/;

function isTrueFlag(value: unknown): boolean {
  return (
    value === true ||
    value === 1 ||
    (typeof value === 'string' && /^(?:true|yes|y|1)$/i.test(value.trim()))
  );
}

function carriesVendField(
  record: Record<string, unknown>,
  isEvidenceKey: (key: string) => boolean
): boolean {
  return Object.entries(record).some(([rawKey, value]) => {
    const key = normaliseKey(rawKey);
    return (
      // An array value ("transactionStatus": ["FAILED"]) is read item by item.
      (Array.isArray(value) ? value : [value]).some(
        (item) =>
          (isEvidenceKey(key) && isEvidenceValue(key, item)) ||
          (OUTCOME_FLAG_KEY.test(key) && isTrueFlag(item))
      )
    );
  });
}

/** Searches every object nested below the top level (responseBody, data…). */
function nestedCarriesVendField(value: unknown, depth: number): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }
  // Nesting deeper than we scan can't be cleared: fail closed.
  if (depth > MAX_NESTED_DEPTH) {
    return true;
  }
  const children = Array.isArray(value) ? value : [value];
  return children.some((child) => {
    const record = asRecord(child);
    if (!record) {
      return nestedCarriesVendField(child, depth + 1);
    }
    return (
      carriesVendField(record, isNestedEvidenceKey) ||
      Object.values(record).some((inner) =>
        nestedCarriesVendField(inner, depth + 1)
      )
    );
  });
}

/**
 * Whether a Monnify answer (a business envelope or a parsed HTTP error body)
 * carries any sign of a vend: a status or a reference, at the top level or
 * in any nested object (responseBody, responseBody.data…), in any key casing.
 * A rejection with such a sign may have reached the network, so it never
 * counts as a pre-vend refusal.
 */
export function hasMonnifyVendEvidence(answer: unknown): boolean {
  // A top-level array (e.g. a list of error objects) is read item by item,
  // each as a top-level answer.
  if (Array.isArray(answer)) {
    return answer.some((item) => hasMonnifyVendEvidence(item));
  }
  const record = asRecord(answer);
  if (!record) {
    return false;
  }
  return (
    carriesVendField(record, isTopLevelEvidenceKey) ||
    hasProviderTopLevelReference(record) ||
    Object.values(record).some((value) => nestedCarriesVendField(value, 1))
  );
}
