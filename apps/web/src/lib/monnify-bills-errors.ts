const SENSITIVE_DIGIT_SEQUENCE_PATTERN = /(?<!\d)\d{7,}(?!\d)/g;
const MONNIFY_ERROR_DETAIL_MAX_LENGTH = 240;
const MONNIFY_ERROR_DETAIL_REDACTION_LOOKAHEAD = 64;

export class MonnifyHttpError extends Error {
  readonly detail: string | null;
  readonly status: number;
  readonly statusText: string;

  constructor({
    detail,
    prefix,
    status,
    statusText,
  }: {
    detail: string | null;
    prefix: string;
    status: number;
    statusText: string;
  }) {
    super(`${prefix}: ${status} ${statusText}`.trim());
    Object.setPrototypeOf(this, MonnifyHttpError.prototype);
    this.name = 'MonnifyHttpError';
    this.detail = detail;
    this.status = status;
    this.statusText = statusText;
  }

  /**
   * A 4xx answer to the request. 408 (timed out) is excluded: the vend may
   * have registered, so it stays an unknown outcome and is resubmitted under
   * the same vend reference, which Monnify then accepts once or reports as
   * a duplicate.
   */
  get isClientError() {
    return this.status >= 400 && this.status < 500 && this.status !== 408;
  }

  /**
   * Monnify already holds a vend under this reference (409, or a 4xx whose
   * detail says so). It may have been delivered, so this is never a refusal
   * another provider may act on.
   */
  get isDuplicateReference() {
    return (
      this.status === 409 ||
      isMonnifyDuplicateReferenceText(this.diagnosticMessage)
    );
  }

  get diagnosticMessage() {
    return this.detail ? `${this.message} - ${this.detail}` : this.message;
  }
}

/**
 * Deliberately broad (fails closed): any answer that talks about the
 * reference, duplicates, something already existing or in use, or a
 * conflict is treated as "Monnify may already hold this vend", so it is
 * never handed to Kuda. A plain refusal such as low float or an invalid
 * customer id does not match.
 */
const MONNIFY_DUPLICATE_REFERENCE_PATTERN =
  /duplicate|reference|already|exist|in\s+use|conflict|idempoten/i;

/** Whether a Monnify message may mean the vend reference was already used. */
export function isMonnifyDuplicateReferenceText(
  text: string | null | undefined
): boolean {
  return !!text && MONNIFY_DUPLICATE_REFERENCE_PATTERN.test(text);
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

async function getMonnifyHttpErrorDetail(response: Response) {
  try {
    const responseText = await response.text();
    if (!responseText.trim()) {
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
  } catch {
    return null;
  }
}

export async function createMonnifyHttpError(
  response: Response,
  prefix: string
) {
  return new MonnifyHttpError({
    detail: await getMonnifyHttpErrorDetail(response),
    prefix,
    status: response.status,
    statusText: response.statusText,
  });
}
