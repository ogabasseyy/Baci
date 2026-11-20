import {
  type MonnifyAnswerReading,
  readMonnifyAnswer,
} from './monnify-answer-reading';
import { redactMonnifyCredentials } from './monnify-credential-redaction';
import {
  hasForeignMonnifyReference,
  ignoreMonnifyRequestEcho,
} from './monnify-rejection-vend-reference';

const SENSITIVE_DIGIT_SEQUENCE_PATTERN = /(?<!\d)\d{7,}(?!\d)/g;
/**
 * Nigerian phone numbers written in groups, e.g. "+234 801 234 5678",
 * "0801-234-5678", "0801.234.5678", "(0801) 234 5678" or
 * "+234 (801) 234 5678", "0801/234/5678" or "801 234 5678" (no prefix). Only phone-shaped groups: other long references stay
 * readable (unbroken runs of 7+ digits are already redacted above).
 */
const SENSITIVE_GROUPED_PHONE_PATTERN =
  /(?<!\d)\(?(?:\+?234\)?[\s./_-]?\(?|0)?[789]\d\d\)?(?:[\s./_-]*\d){7}(?!\d)/g;
/**
 * Any other grouped number that starts like a phone number ("+" or a leading
 * 0) and runs to 10+ digits, e.g. foreign or unusual Nigerian ranges.
 */
const SENSITIVE_GROUPED_DIALLED_NUMBER_PATTERN =
  /(?<!\d)(?:\+\(?|\(?0)\d(?:\s*[./()_-]{0,3}\s*\d){9,}(?!\d)/g;
/**
 * Any grouped number of 11+ digits whatever its prefix, e.g. an international
 * number written without "+" ("44 20 7946 0958"). Shorter grouped references
 * stay readable.
 */
const SENSITIVE_LONG_GROUPED_NUMBER_PATTERN =
  /(?<!\d)\d(?:\s*[./()_-]{0,3}\s*\d){10,}(?!\d)/g;
/**
 * A 3-3-4 grouped local number with no prefix, e.g. "415 555 0132" or
 * "(415) 555-0132". Other grouped references (e.g. "1234 5678 99") stay
 * readable. Trade-off: a non-phone reference shaped 3-3-4 is hidden too;
 * losing a debug detail is accepted over persisting a customer number.
 */
const SENSITIVE_THREE_THREE_FOUR_PATTERN =
  /(?<!\d)\(?\d{3}\)?[\s./_-]+\d{3}[\s./_-]+\d{4}(?!\d)/g;
const MONNIFY_ERROR_DETAIL_MAX_LENGTH = 240;
const MONNIFY_ERROR_DETAIL_REDACTION_LOOKAHEAD = 64;

export class MonnifyHttpError extends Error {
  readonly detail: string | null;
  readonly status: number;
  /**
   * Classified from Monnify's full, unscrubbed answer when the error is
   * created; the raw text itself is never kept, so nothing can log it.
   */
  readonly #reading: MonnifyAnswerReading;
  readonly statusText: string;

  constructor({
    detail,
    prefix,
    rawDetail = null,
    status,
    statusText,
  }: {
    detail: string | null;
    prefix: string;
    rawDetail?: string | null;
    status: number;
    statusText: string;
  }) {
    // The reason phrase is scrubbed like the body (it is persisted).
    const safeStatusText = sanitizeMonnifyErrorDetail(statusText);
    super(`${prefix}: ${status} ${safeStatusText}`.trim());
    Object.setPrototypeOf(this, MonnifyHttpError.prototype);
    this.name = 'MonnifyHttpError';
    this.detail = detail;
    const body = rawDetail ?? detail ?? '';
    this.#reading = readMonnifyAnswer(this.message, body);
    this.status = status;
    this.statusText = safeStatusText;
  }

  get isClientError() {
    return this.status >= 400 && this.status < 500;
  }

  /** A known pre-vend refusal (amount check, low float). */
  get isKnownRefusal() {
    return this.#reading.isKnownRefusal;
  }

  /** Monnify's code 99 ("unexpected error, re-query"): outcome unknown. */
  get reportsUnexpectedError() {
    return this.#reading.reportsUnexpectedError;
  }

  /** Monnify's own response code (e.g. "99"), safe to store. */
  get responseCode() {
    return this.#reading.responseCode;
  }

  /** The body carries login/credential wording (never goes to Kuda). */
  get mentionsAuthWording() {
    return this.#reading.mentionsAuthWording;
  }

  /** The JSON body carries a vend status or reference: a vend may exist. */
  get showsVendEvidence() {
    return this.#reading.showsVendEvidence;
  }

  /** The answer talks about a vend outcome or an unavailable service. */
  get mentionsVendOutcome() {
    return this.#reading.mentionsVendOutcome;
  }

  /**
   * Monnify already holds a vend under this reference (409, or an answer
   * that says so). It may have been delivered, so this is never a refusal
   * another provider may act on.
   */
  get isDuplicateReference() {
    return this.status === 409 || this.#reading.isDuplicateReference;
  }

  /**
   * The answer leaves the vend's outcome open: a timeout (408), a duplicate
   * reference (409 or its wording), a vend status or wording that says the
   * vend ran or is running, or an open code (99, 2xx, 408, 409, 5xx) without
   * a known refusal. Login rejections (401/403) never count (owner decision
   * 2026-11-18: refunded), nor throttles (429).
   */
  // Precedence is deliberate: a Monnify-issued reference beside even a known
  // refusal (low float, amount check) means a transaction record exists, so
  // the row is held, not refunded and not sent to Kuda. A delayed manual
  // refund is safer than paying a possibly-delivered vend twice.
  leavesOutcomeOpenFor(requestReference: string) {
    // 401/403/429 (or the same codes inside an HTTP 400 body) are login
    // rejections/throttles: refunded (owner decision 2026-11-18), except that
    // a real voucher token means a vend delivered, so it still holds.
    if (
      this.status === 401 ||
      this.status === 403 ||
      this.status === 429 ||
      /^0*(?:401|403|429)$/.test(this.#reading.responseCode ?? '') ||
      this.#reading.authOrThrottleCode ||
      // Authentication wording is refund-only whatever the code and body.
      this.#reading.mentionsAuthWording
    ) {
      return this.#reading.bodyHasToken;
    }
    return (
      this.status === 408 ||
      this.isDuplicateReference ||
      this.#reading.leavesOutcomeOpen ||
      hasForeignMonnifyReference(
        this.#reading.providerReferences,
        requestReference
      )
    );
  }

  /** An explicit vend-level FAILED with nothing open (proof for a requery). */
  get provesVendFailure() {
    return this.#reading.provesVendFailure;
  }

  /** A 401/403/429 code anywhere in the body (login rejection or throttle). */
  get authOrThrottleCode() {
    return this.#reading.authOrThrottleCode;
  }

  /** The body carries a real voucher token: a vend may have delivered. */
  get bodyHasToken() {
    return this.#reading.bodyHasToken;
  }

  /** The body names the vend delivered: never retry it. */
  get showsDeliveredStatus() {
    return this.#reading.showsDeliveredStatus;
  }

  /** Monnify's own vendReference in the body, when it gave one. */
  providerVendReference(requestReference: string) {
    return ignoreMonnifyRequestEcho(
      this.#reading.vendReferenceCandidate,
      requestReference
    );
  }

  get diagnosticMessage() {
    return this.detail ? `${this.message} - ${this.detail}` : this.message;
  }
}

export class MonnifyTransientVendError extends Error {
  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, MonnifyTransientVendError.prototype);
    this.name = 'MonnifyTransientVendError';
  }
}

export function sanitizeMonnifyErrorDetail(value: string) {
  // Redact over a generous window first, then cut to the stored length, so
  // a number that straddles the cut (grouped or not) is already hidden.
  const redactionBound =
    MONNIFY_ERROR_DETAIL_MAX_LENGTH + MONNIFY_ERROR_DETAIL_REDACTION_LOOKAHEAD;
  let boundedValue = value.slice(0, redactionBound);

  if (
    boundedValue.length === redactionBound &&
    /\d$/.test(boundedValue) &&
    /^\d/.test(value.slice(redactionBound, redactionBound + 1))
  ) {
    boundedValue = boundedValue.replace(/[\d\s./()_+-]+$/, '');
  }

  const redacted = redactMonnifyCredentials(boundedValue)
    .replace(SENSITIVE_DIGIT_SEQUENCE_PATTERN, '[redacted]')
    .replace(SENSITIVE_GROUPED_PHONE_PATTERN, '[redacted]')
    .replace(SENSITIVE_GROUPED_DIALLED_NUMBER_PATTERN, '[redacted]')
    .replace(SENSITIVE_LONG_GROUPED_NUMBER_PATTERN, '[redacted]')
    .replace(SENSITIVE_THREE_THREE_FOUR_PATTERN, '[redacted]');
  if (redacted.length <= MONNIFY_ERROR_DETAIL_MAX_LENGTH) {
    return redacted.trim();
  }
  // Drop a trailing digit group only when the cut split a number (the next
  // character continues it), so a whole code such as "code 99" survives.
  const cut = redacted.slice(0, MONNIFY_ERROR_DETAIL_MAX_LENGTH);
  const rest = redacted.slice(MONNIFY_ERROR_DETAIL_MAX_LENGTH);
  const cutSplitANumber =
    /\d[\s./()_+-]?$/.test(cut) && /^[\s./()_+-]?\d/.test(rest);
  return (
    cutSplitANumber ? cut.replace(/[\d\s./()_+-]*\d[\s./()_+-]?$/, '') : cut
  ).trim();
}

function getMonnifyErrorDetailFromBody(value: unknown): string | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const body = value as Record<string, unknown>;
  const candidates = [
    body.responseMessage,
    body.message,
    body.error,
    body.errorMessage,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return sanitizeMonnifyErrorDetail(candidate);
    }
  }

  return null;
}

function getMonnifyHttpErrorDetail(responseText: string | null) {
  if (!responseText?.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(responseText) as unknown;
    return (
      getMonnifyErrorDetailFromBody(parsed) ??
      sanitizeMonnifyErrorDetail(responseText)
    );
  } catch {
    // A form-encoded body is decoded first, so "Invalid+token+abc123" is
    // redacted like the plain text it stands for.
    return sanitizeMonnifyErrorDetail(decodeFormText(responseText));
  }
}

function decodeFormText(text: string): string {
  try {
    return decodeURIComponent(text.replace(/\+/g, ' '));
  } catch {
    return text.replace(/\+/g, ' ');
  }
}

export async function createMonnifyHttpError(
  response: Response,
  prefix: string
) {
  let responseText: string | null = null;
  try {
    responseText = await response.text();
  } catch {
    responseText = null;
  }
  return new MonnifyHttpError({
    detail: getMonnifyHttpErrorDetail(responseText),
    prefix,
    // Only classified inside the constructor, never stored.
    rawDetail: responseText?.trim() ? responseText : null,
    status: response.status,
    statusText: response.statusText,
  });
}
