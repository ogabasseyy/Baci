import { isMonnifyDuplicateReferenceText } from './monnify-duplicate-reference';

const SENSITIVE_DIGIT_SEQUENCE_PATTERN = /(?<!\d)\d{7,}(?!\d)/g;
/** Numbers written in groups, e.g. "+234 801 234 5678" or "0801-234-5678". */
const SENSITIVE_GROUPED_NUMBER_PATTERN =
  /\+?(?<![\d])\d(?:[ -]?\d){6,}(?![\d])/g;
const MONNIFY_ERROR_DETAIL_MAX_LENGTH = 240;
const MONNIFY_ERROR_DETAIL_REDACTION_LOOKAHEAD = 64;

export class MonnifyHttpError extends Error {
  readonly detail: string | null;
  /**
   * Monnify's full, unscrubbed error body. Only for classifying the answer
   * (duplicate, known refusal) before it is cut short; never log or store it.
   */
  readonly rawDetail: string | null;
  readonly status: number;
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
    // Not enumerable, so logging or serialising the error never carries
    // the unscrubbed body (it is read directly, for classification only).
    Object.defineProperty(this, 'rawDetail', {
      enumerable: false,
      value: rawDetail,
    });
    this.status = status;
    this.statusText = statusText;
  }

  get isClientError() {
    return this.status >= 400 && this.status < 500;
  }

  /** The full answer, for classification only (see rawDetail). */
  get classificationText() {
    return `${this.message} - ${this.rawDetail ?? this.detail ?? ''}`;
  }

  /**
   * Monnify already holds a vend under this reference (409, or a 4xx whose
   * detail says so). It may have been delivered, so this is never a refusal
   * another provider may act on.
   */
  get isDuplicateReference() {
    return (
      this.status === 409 ||
      isMonnifyDuplicateReferenceText(this.classificationText)
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
    .replace(SENSITIVE_GROUPED_NUMBER_PATTERN, '[redacted]')
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
    rawDetail: responseText?.trim() ? responseText : null,
    status: response.status,
    statusText: response.statusText,
  });
}
