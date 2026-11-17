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
   * A 4xx that means Monnify refused the request, so nothing was vended.
   * 408 (timed out) and 409 (duplicate vend reference) can follow a vend
   * that went through, so they stay unknown outcomes to requery: treating
   * them as failures would refund, or vend again through Kuda, while the
   * customer may already have their airtime.
   */
  get isClientError() {
    return (
      this.status >= 400 &&
      this.status < 500 &&
      this.status !== 408 &&
      this.status !== 409
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
