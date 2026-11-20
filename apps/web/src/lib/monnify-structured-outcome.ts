import { HTTP_STATUS_LABEL } from './monnify-vend-evidence';

const MAX_DEPTH = 6;

/** Vend states that say the vend is still running: Monnify may yet deliver. */
export const RUNNING_STATUSES = new Set([
  'ACCEPTED',
  'INITIATED',
  'INPROGRESS',
  'PENDING',
  'PROCESSING',
  'QUEUED',
  'SUBMITTED',
]);
/** States that say the vend ran (or the payment was taken). */
export const DONE_STATUSES = new Set([
  'COMPLETED',
  'PAID',
  'SUCCESS',
  'SUCCESSFUL',
]);
/** Explicit failure: the same names classifyMonnifyBillStatus treats as failed. */
export const FAILED_STATUSES = new Set(['FAILED', 'FAILURE', 'UNSUCCESSFUL']);

/** Vend-specific status keys (not a bare `status`). */
const VEND_STATUS_KEY =
  /^(?!(?:http|response|result)?status(?:code)?$)(?!(?:customer|product|biller|item|service|package|plan|validation|request|merchant|account|user|payment|refund|reversal|settlement|callback|webhook|notification|chargeback|lookup|query|requery|enquiry|inquiry|error|exception|auth|authentication|credential|login|access|oauth)).+status$/;

/**
 * A generic `status` that is not an HTTP reason phrase, an error label or a
 * number ("UNKNOWN", a new provider state) is a vend state we do not know,
 * like vend evidence reads it.
 */
function isGenericVendLikeStatus(key: string, value: string): boolean {
  if (!/^(?:http|response|result)?status(?:code)?$/.test(key)) {
    return false;
  }
  const label = value
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/^\d{3}\s+(?=\D)/, '');
  return (
    /\D/.test(label) &&
    !HTTP_STATUS_LABEL.test(label) &&
    !/^(?:false|null|no|n)$/i.test(label)
  );
}

const VEND_FLAG_KEY =
  /^(?:is|was|has)?(?:been)?(?:vend|transaction|txn|purchase|airtime|delivered|dispatched|vended|credited|recharged|toppedup)/;
/** customerStatus, productStatus, refundStatus...: another object's state, never the vend's. */
export const NON_VEND_STATUS_PREFIX =
  /^(?:customer|product|biller|item|service|package|plan|validation|request|merchant|account|user|refund|reversal|settlement|callback|webhook|notification|chargeback|lookup|query|requery|enquiry|inquiry|error|exception|auth|authentication|credential|login|access|oauth).*status$/;
export const NON_VEND_PARENT =
  /^(?:customer|product|biller|item|service|package|plan|account|merchant|user|validation|request|lookup|query|requery|enquiry|inquiry|refund|reversal|settlement|callback|webhook|notification|chargeback|error|exception|auth|authentication|credential|login|access|oauth)s?$/;
const STRONG_FAILED_FLAG = /^(?:is|was|has)?(?:been)?(?:failed|failure)$/;
const PAYMENT_LEVEL_FLAG = /^(?:is|was|has)?(?:been)?payment/;

/** True outcome flags, key normalised: "delivered", "isPending", "vendFailed"... */
const RUNNING_FLAG =
  /^(?:is|was|has)?(?:been)?(?:vend|transaction|txn|purchase|payment|airtime)?(?:has)?(?:been)?(?:pending|inprogress|queued|submitted|accepted|initiated|attempted|timedout)$/;
const DONE_FLAG =
  /^(?:is|was|has)?(?:been)?(?:vend|transaction|txn|purchase|payment|airtime)?(?:has)?(?:been)?(?:processed|delivered|completed|vended|successful|success|dispatched|fulfilled|credited|recharged|toppedup)$/;
const FAILED_FLAG =
  /^(?:is|was|has)?(?:been)?(?:vend|transaction|txn|purchase|payment|airtime)?(?:has)?(?:been)?(?:failed|failure|rejected|cancell?ed|reversed|declined)$/;

function isTrueFlag(value: unknown): boolean {
  return (
    value === true ||
    value === 1 ||
    (typeof value === 'string' && /^(?:true|yes|y|1)$/i.test(value.trim()))
  );
}

export interface StructuredOutcome {
  running: boolean;
  done: boolean;
  failed: boolean;
  /** Vend-level (not generic payment) done / failed: these take precedence. */
  vendDone: boolean;
  vendFailed: boolean;
  /** A bare `status: FAILED` inside responseBody. */
  bodyStatusFailed: boolean;
  /** A vend-specific status Monnify named that is not a state we know. */
  unknown: boolean;
  /** Nested deeper than we scan: can't be cleared, so it holds. */
  incomplete: boolean;
}

/**
 * A vend-level status beats a generic payment-level one, like
 * classifyMonnifyBillStatus (vendStatus first): payment FAILED with vend
 * COMPLETED is a delivered vend; payment SUCCESS with vend FAILED is failed.
 */
export function settleVendPrecedence(found: StructuredOutcome): void {
  // A bare `status: FAILED` inside the result body is the bill outcome (the
  // success classifier reads it so) unless a vend-specific state says
  // otherwise. A generic top-level status stays a lookup status.
  if (
    found.bodyStatusFailed &&
    !found.vendFailed &&
    !found.vendDone &&
    !found.unknown &&
    !found.running
  ) {
    found.vendFailed = true;
  }
  // Two vend-level outcomes that contradict each other (FAILED beside
  // SUCCESS, failed: true beside delivered: true): neither has authority.
  if (found.vendFailed && found.vendDone) {
    found.unknown = true;
  }
  found.failed = found.vendFailed || (found.failed && !found.vendDone);
  found.done = found.done && !found.failed;
}

/**
 * Reads every string value under a key ending in "status" and every true
 * outcome flag (delivered: true, pending: true...), at any depth.
 */
export function readStructuredOutcome(
  answer: unknown,
  found: StructuredOutcome,
  depth = 0,
  inBody = false,
  underNonVend = false
): void {
  if (!answer || typeof answer !== 'object') {
    return;
  }
  if (depth > MAX_DEPTH) {
    found.incomplete = true;
    return;
  }
  const children = Array.isArray(answer)
    ? answer.map((item) => ['', item] as const)
    : Object.entries(answer);
  for (const [rawKey, value] of children) {
    const key = rawKey.replace(/[\s_-]/g, '').toLowerCase();
    // An array value ("transactionStatus": ["UNKNOWN"]) is read item by item.
    for (const item of Array.isArray(value) ? value : [value]) {
      if (
        key.endsWith('status') &&
        !NON_VEND_STATUS_PREFIX.test(key) &&
        typeof item === 'string' &&
        // A bare `status` under customer/product/... describes that object.
        !underNonVend
      ) {
        const status = item.replace(/[\s_-]/g, '').toUpperCase();
        found.running ||= RUNNING_STATUSES.has(status);
        found.done ||= DONE_STATUSES.has(status);
        found.failed ||= FAILED_STATUSES.has(status);
        if (inBody && key === 'status' && FAILED_STATUSES.has(status)) {
          found.bodyStatusFailed = true;
        }
        if (VEND_STATUS_KEY.test(key)) {
          found.vendDone ||= DONE_STATUSES.has(status);
          found.vendFailed ||= FAILED_STATUSES.has(status);
        }
        // A vend-specific status ("vendStatus: UNKNOWN", a new provider state)
        // that is not a known state proves nothing, so it is not a refusal.
        // A generic `status` counts only when it is not an HTTP/error label.
        found.unknown ||=
          (VEND_STATUS_KEY.test(key) || isGenericVendLikeStatus(key, item)) &&
          status !== '' &&
          !RUNNING_STATUSES.has(status) &&
          !DONE_STATUSES.has(status) &&
          !FAILED_STATUSES.has(status);
      }
      // A numeric vend-specific state (vendStatus: 2) is a vend state we do not
      // know: hold, like vend evidence does.
      if (typeof item === 'number' && VEND_STATUS_KEY.test(key)) {
        found.unknown = true;
      }
    }
    // An array flag ("delivered": [true]) is read item by item too.
    if ((Array.isArray(value) ? value : [value]).some(isTrueFlag)) {
      found.running ||= RUNNING_FLAG.test(key);
      found.done ||= DONE_FLAG.test(key);
      found.failed ||= FAILED_FLAG.test(key);
      // A payment-level flag (paymentSuccessful) is subordinate to the vend:
      // only vend/delivery-level flags count as vend outcomes.
      // And only a vend-specific flag, or one inside a result body, proves a
      // vend outcome: a top-level `failed: true` may describe the request.
      if (
        !PAYMENT_LEVEL_FLAG.test(key) &&
        (inBody || VEND_FLAG_KEY.test(key)) &&
        !underNonVend
      ) {
        found.vendDone ||= DONE_FLAG.test(key);
        // `failed`/`failure` inside the body prove it; "reversed" or "declined"
        // alone do not (runbook decision), unless vend-scoped (vendReversed).
        found.vendFailed ||=
          FAILED_FLAG.test(key) &&
          (VEND_FLAG_KEY.test(key) || STRONG_FAILED_FLAG.test(key));
      }
    }
    readStructuredOutcome(
      value,
      found,
      depth + 1,
      inBody || key === 'responsebody',
      // Any excluded ancestor (request, refund, error...) excludes the subtree.
      underNonVend || NON_VEND_PARENT.test(key)
    );
  }
}

/** A fresh outcome with nothing read yet. */
export function createStructuredOutcome(): StructuredOutcome {
  return {
    running: false,
    done: false,
    failed: false,
    vendDone: false,
    vendFailed: false,
    bodyStatusFailed: false,
    unknown: false,
    incomplete: false,
  };
}
