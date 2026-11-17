import { joinMonnifyAnswerStrings } from './monnify-answer-strings';
import { readsAsMonnifyAuthRejection } from './monnify-auth-rejection';
import { isMonnifyDuplicateReferenceText } from './monnify-duplicate-reference';
import { reportsMonnifyUnexpectedError } from './monnify-unexpected-error-text';
import { hasMonnifyVendEvidence } from './monnify-vend-evidence';
import { mentionsMonnifyVendEvidence } from './monnify-vend-evidence-text';
import { isMonnifyVendOutcomeText } from './monnify-vend-outcome';
import { isMonnifyKnownVendRefusalText } from './monnify-vend-refusal';

const SENSITIVE_DIGIT_SEQUENCE_PATTERN = /(?<!\d)\d{7,}(?!\d)/g;
/**
 * Nigerian phone numbers written in groups, e.g. "+234 801 234 5678",
 * "0801-234-5678", "0801.234.5678", "(0801) 234 5678" or
 * "+234 (801) 234 5678", "0801/234/5678" or "801 234 5678" (no prefix). Only phone-shaped groups: other long references stay
 * readable (unbroken runs of 7+ digits are already redacted above).
 */
const SENSITIVE_GROUPED_PHONE_PATTERN =
  /(?<!\d)\(?(?:\+?234\)?[\s./-]?\(?|0)?[789]\d\d\)?(?:[\s./-]*\d){7}(?!\d)/g;
/**
 * Any other grouped number that starts like a phone number ("+" or a leading
 * 0) and runs to 10+ digits, e.g. foreign or unusual Nigerian ranges.
 */
const SENSITIVE_GROUPED_DIALLED_NUMBER_PATTERN =
  /(?<!\d)(?:\+\(?|\(?0)\d(?:[\s./()-]{0,3}\d){9,}(?!\d)/g;
/**
 * Any grouped number of 11+ digits whatever its prefix, e.g. an international
 * number written without "+" ("44 20 7946 0958"). Shorter grouped references
 * stay readable.
 */
const SENSITIVE_LONG_GROUPED_NUMBER_PATTERN =
  /(?<!\d)\d(?:[\s./()-]{0,3}\d){10,}(?!\d)/g;
/** How Monnify's full answer reads, worked out once from the unscrubbed text. */
interface MonnifyAnswerReading {
  isDuplicateReference: boolean;
  isKnownRefusal: boolean;
  mentionsVendOutcome: boolean;
  reportsUnexpectedError: boolean;
  readsAsAuthRejection: boolean;
  showsVendEvidence: boolean;
}

/**
 * A JSON body is read structurally, plus the text of its string values (not
 * its keys, so a top-level reference echo does not count). Anything else is
 * read as plain text.
 */
function showsVendEvidence(body: string): boolean {
  const parsed = parseJsonOrNull(body);
  if (parsed && typeof parsed === 'object') {
    return (
      hasMonnifyVendEvidence(parsed) ||
      mentionsMonnifyVendEvidence(joinMonnifyAnswerStrings(parsed))
    );
  }
  return mentionsMonnifyVendEvidence(body);
}

function parseJsonOrNull(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/**
 * `text` is the status line plus the body; `body` is Monnify's answer alone.
 * Auth wording is read from the body only: every 401/403 status line says
 * "Unauthorized" or "Forbidden", which proves nothing about the reason.
 */
function readMonnifyAnswer(text: string, body: string): MonnifyAnswerReading {
  return {
    isDuplicateReference: isMonnifyDuplicateReferenceText(text),
    isKnownRefusal: isMonnifyKnownVendRefusalText(text),
    mentionsVendOutcome: isMonnifyVendOutcomeText(text),
    reportsUnexpectedError: reportsMonnifyUnexpectedError(body),
    readsAsAuthRejection: readsAsMonnifyAuthRejection(body),
    showsVendEvidence: showsVendEvidence(body),
  };
}

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
    super(`${prefix}: ${status} ${statusText}`.trim());
    Object.setPrototypeOf(this, MonnifyHttpError.prototype);
    this.name = 'MonnifyHttpError';
    this.detail = detail;
    const body = rawDetail ?? detail ?? '';
    this.#reading = readMonnifyAnswer(`${this.message} - ${body}`, body);
    this.status = status;
    this.statusText = statusText;
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

  /** The answer reads as an authentication rejection, not just its status. */
  get readsAsAuthRejection() {
    return this.#reading.readsAsAuthRejection;
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
    boundedValue = boundedValue.replace(/[\d\s./()+-]+$/, '');
  }

  const redacted = boundedValue
    .replace(SENSITIVE_DIGIT_SEQUENCE_PATTERN, '[redacted]')
    .replace(SENSITIVE_GROUPED_PHONE_PATTERN, '[redacted]')
    .replace(SENSITIVE_GROUPED_DIALLED_NUMBER_PATTERN, '[redacted]')
    .replace(SENSITIVE_LONG_GROUPED_NUMBER_PATTERN, '[redacted]');
  if (redacted.length <= MONNIFY_ERROR_DETAIL_MAX_LENGTH) {
    return redacted.trim();
  }
  // Drop a trailing digit group only when the cut split a number (the next
  // character continues it), so a whole code such as "code 99" survives.
  const cut = redacted.slice(0, MONNIFY_ERROR_DETAIL_MAX_LENGTH);
  const rest = redacted.slice(MONNIFY_ERROR_DETAIL_MAX_LENGTH);
  const cutSplitANumber =
    /\d[\s./()+-]?$/.test(cut) && /^[\s./()+-]?\d/.test(rest);
  return (
    cutSplitANumber ? cut.replace(/[\d\s./()+-]*\d[\s./()+-]?$/, '') : cut
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
    return sanitizeMonnifyErrorDetail(responseText);
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
