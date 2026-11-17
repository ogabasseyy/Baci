import { isMonnifyDuplicateReferenceText } from './monnify-duplicate-reference';
import { isMonnifyVendOutcomeText } from './monnify-vend-outcome';
import { isMonnifyKnownVendRefusalText } from './monnify-vend-refusal';

const SENSITIVE_DIGIT_SEQUENCE_PATTERN = /(?<!\d)\d{7,}(?!\d)/g;
/**
 * Nigerian phone numbers written in groups, e.g. "+234 801 234 5678",
 * "0801-234-5678", "0801.234.5678", "(0801) 234 5678" or
 * "+234 (801) 234 5678". Only phone-shaped groups: other long references stay
 * readable (unbroken runs of 7+ digits are already redacted above).
 */
const SENSITIVE_GROUPED_PHONE_PATTERN =
  /(?<!\d)\(?(?:\+?234\)?[ .-]?\(?|0)[789][01]\d\)?(?:[ .-]?\d){7}(?!\d)/g;
/** How Monnify's full answer reads, worked out once from the unscrubbed text. */
interface MonnifyAnswerReading {
  isDuplicateReference: boolean;
  isKnownRefusal: boolean;
  mentionsVendOutcome: boolean;
  reportsUnexpectedError: boolean;
}

function readMonnifyAnswer(text: string): MonnifyAnswerReading {
  return {
    isDuplicateReference: isMonnifyDuplicateReferenceText(text),
    isKnownRefusal: isMonnifyKnownVendRefusalText(text),
    mentionsVendOutcome: isMonnifyVendOutcomeText(text),
    reportsUnexpectedError: /"responseCode"\s*:\s*"?99"?(?!\d)/.test(text),
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
    this.#reading = readMonnifyAnswer(
      `${this.message} - ${rawDetail ?? detail ?? ''}`
    );
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
  const redactionBound =
    MONNIFY_ERROR_DETAIL_MAX_LENGTH + MONNIFY_ERROR_DETAIL_REDACTION_LOOKAHEAD;
  let boundedValue = value.slice(0, redactionBound);

  if (
    boundedValue.length === redactionBound &&
    /\d$/.test(boundedValue) &&
    /^\d/.test(value.slice(redactionBound, redactionBound + 1))
  ) {
    boundedValue = boundedValue.replace(/\d+$/, '');
  }

  return boundedValue
    .replace(SENSITIVE_DIGIT_SEQUENCE_PATTERN, '[redacted]')
    .replace(SENSITIVE_GROUPED_PHONE_PATTERN, '[redacted]')
    .slice(0, MONNIFY_ERROR_DETAIL_MAX_LENGTH)
    .trim();
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
