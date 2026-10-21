/**
 * ZeptoMail send-error parsing: normalize provider/transport failures into
 * a SendFailure record. Split from the retry unit to honor the 300-line
 * modularity gate.
 */
interface ZeptoMailError {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
  message?: string;
}

export interface SendFailure {
  message: string;
  code?: string;
  details?: unknown;
}

/**
 * Parse ZeptoMail error response
 */
export function parseError(error: unknown): SendFailure {
  if (error instanceof Error) {
    const code =
      'code' in error && typeof error.code === 'string'
        ? error.code
        : undefined;
    return { message: error.message, code };
  }

  const zeptoError = error as ZeptoMailError;
  if (zeptoError?.error) {
    return {
      message: zeptoError.error.message || 'Unknown ZeptoMail error',
      code: zeptoError.error.code,
      details: zeptoError.error.details,
    };
  }

  return { message: String(error) };
}
