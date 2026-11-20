import { mentionsMonnifyAuthWording } from './monnify-auth-wording';
import { hasMonnifyDuplicateFlag } from './monnify-duplicate-flag';
import { isMonnifyDuplicateReferenceText } from './monnify-duplicate-reference';
import { hasMonnifyUnresolvedCode } from './monnify-non-definitive-code';
import { hasMonnifyProviderReference } from './monnify-rejection-vend-reference';
import { normaliseMonnifyWording } from './monnify-text-normalise';
import { reportsMonnifyUnresolvedCode } from './monnify-unexpected-error-text';
import { HTTP_STATUS_LABEL } from './monnify-vend-evidence';
import { isMonnifyKnownVendRefusalText } from './monnify-vend-refusal';

const MAX_DEPTH = 6;
/** Wording is cut before the regex runs, so provider text can't make it slow. */
const MAX_WORDING_LENGTH = 4000;

/** Vend states that say the vend is still running: Monnify may yet deliver. */
const RUNNING_STATUSES = new Set([
  'ACCEPTED',
  'INITIATED',
  'INPROGRESS',
  'PENDING',
  'PROCESSING',
  'QUEUED',
  'SUBMITTED',
]);
/** States that say the vend ran (or the payment was taken). */
const DONE_STATUSES = new Set(['COMPLETED', 'PAID', 'SUCCESS', 'SUCCESSFUL']);
/** Explicit failure: the same names classifyMonnifyBillStatus treats as failed. */
const FAILED_STATUSES = new Set(['FAILED', 'FAILURE', 'UNSUCCESSFUL']);

/**
 * The same states (and a timeout or a request to re-query) as wording. A
 * negated state ("not delivered", "could not be completed", "has not yet
 * been processed") and a check before the vend ("validation successful")
 * do not count.
 */
const IN_FLIGHT_WORDING =
  /(?<!\b(?:not|never|no|cannot|n't)(?:\s+\w+){0,3}?\s+)(?<!(?:validation|verification|lookup|login|authentication|customer)\s+(?:(?:was|is|were|has|have|been|being|also|now)\s+)*)\b(?:pending|processing|in\s+progress|queued|initiated|submitted|accepted|successful(?:ly)?|succeeded|success|delivered|completed|credited|vended|dispatched|timed?\s*out|re\s*quer(?:y|ied)|(?:service\s+)?(?:temporarily\s+)?unavailable)\b/i;

/** Vend-specific status keys (not a bare `status`). */
const VEND_STATUS_KEY =
  /^(?!(?:http|response|result)?status(?:code)?$)(?!(?:customer|product|biller|item|service|package|plan|validation|request|merchant|account|user|payment)).+status$/;

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
const NON_VEND_PARENT =
  /^(?:customer|product|biller|item|service|package|plan|account|merchant|user|validation)s?$/;
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

interface StructuredOutcome {
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
function settleVendPrecedence(found: StructuredOutcome): void {
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
function readStructuredOutcome(
  answer: unknown,
  found: StructuredOutcome,
  depth = 0,
  inBody = false,
  parentKey = ''
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
        typeof item === 'string' &&
        // A bare `status` under customer/product/... describes that object.
        !(key === 'status' && NON_VEND_PARENT.test(parentKey))
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
        (inBody || VEND_FLAG_KEY.test(key))
      ) {
        found.vendDone ||= DONE_FLAG.test(key);
        found.vendFailed ||= FAILED_FLAG.test(key);
      }
    }
    readStructuredOutcome(
      value,
      found,
      depth + 1,
      inBody || key === 'responsebody',
      key
    );
  }
}

/**
 * Whether a Monnify rejection leaves the vend's outcome open, so the
 * customer must not be refunded straight away (Monnify may still deliver).
 *
 * `answer` is the parsed body (or null), `wording` Monnify's own text (string
 * values only, never JSON keys). Strong signs hold the row whatever else the
 * answer says: a duplicate reference, a vend status or wording that says the
 * vend ran or is running. A response code alone (99, 2xx, 408, 409, 5xx)
 * holds it too, unless Monnify's wording is a known refusal before any vend
 * (low float, amount check), which keeps today's refund.
 */
export function isMonnifyUnresolvedAnswer({
  answer,
  requestReference,
  wording,
}: {
  answer: unknown;
  /** When given, a Monnify reference in the body (not an echo of ours) holds. */
  requestReference?: string;
  wording: string;
}): boolean {
  const outcome: StructuredOutcome = {
    running: false,
    done: false,
    failed: false,
    vendDone: false,
    vendFailed: false,
    bodyStatusFailed: false,
    unknown: false,
    incomplete: false,
  };
  readStructuredOutcome(answer, outcome);
  settleVendPrecedence(outcome);
  // A running vend holds whatever else the body says. A done state (payment
  // taken, delivered) holds unless the same body names an explicit failure,
  // like classifyMonnifyBillStatus (FAILED beats a payment-level SUCCESS).
  // With an explicit failure and nothing running, the structure wins over
  // wording that only echoes the success state.
  const structuredHold =
    outcome.running ||
    outcome.incomplete ||
    // An unrecognised vend state proves nothing, even beside a FAILED one.
    outcome.unknown ||
    (outcome.done && !outcome.failed);
  const wordingHolds =
    !(outcome.failed && !outcome.running) &&
    IN_FLIGHT_WORDING.test(
      normaliseMonnifyWording(wording.slice(0, MAX_WORDING_LENGTH))
    );
  const strong =
    hasMonnifyDuplicateFlag(answer) ||
    isMonnifyDuplicateReferenceText(wording) ||
    structuredHold ||
    // A Monnify-issued reference in the body means a vend may exist.
    (requestReference !== undefined &&
      hasMonnifyProviderReference(answer, requestReference)) ||
    wordingHolds;
  if (strong) {
    return true;
  }
  const codeLeavesOutcomeOpen =
    hasMonnifyUnresolvedCode(answer) || reportsMonnifyUnresolvedCode(wording);
  // A login rejection with an open code is still refunded (owner decision
  // 2026-11-18), like a known refusal.
  return (
    codeLeavesOutcomeOpen &&
    !isMonnifyKnownVendRefusalText(wording) &&
    !mentionsMonnifyAuthWording(wording)
  );
}

/**
 * Whether a parsed Monnify answer names the vend itself as failed (FAILED
 * status or failed: true) with nothing still running or unrecognised: proof
 * of failure for a rejected requery whose message does not say so.
 */
export function hasMonnifyExplicitVendFailure(answer: unknown): boolean {
  const outcome: StructuredOutcome = {
    running: false,
    done: false,
    failed: false,
    vendDone: false,
    vendFailed: false,
    bodyStatusFailed: false,
    unknown: false,
    incomplete: false,
  };
  readStructuredOutcome(answer, outcome);
  settleVendPrecedence(outcome);
  // Only a VEND-level failure proves it: a generic top-level `status: FAILED`
  // may describe the lookup request itself.
  return (
    outcome.vendFailed &&
    !outcome.vendDone &&
    !outcome.running &&
    !outcome.unknown &&
    !outcome.incomplete
  );
}
