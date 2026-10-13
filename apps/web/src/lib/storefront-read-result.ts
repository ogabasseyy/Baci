const DATABASE_ERROR_CODE_PATTERN = /^(?:[0-9A-Z]{5}|PGRST\d+)$/;
const TIMEOUT_ERROR_CODES = new Set(['20', '23', '57014', 'PGRST003']);
const RETRYABLE_HTTP_STATUSES = new Set([
  408, 429, 502, 503, 504, 520, 521, 522,
]);
// PostgREST group-0 codes (PGRST000-002) are 503 connection / schema-cache
// failures — transient transport, NOT stable database errors. They must be
// classified before the generic PGRST-code branch so they stay retryable
// during a Supabase outage or schema-cache restart.
const CONNECTION_ERROR_CODES = new Set(['PGRST000', 'PGRST001', 'PGRST002']);
const TIMEOUT_MESSAGE_PATTERN =
  /(?:abort(?:ed)? due to timeout|operation was aborted|pool acquisition timeout|request timeout|statement timeout|timeouterror|timed out)/i;
const TRANSPORT_MESSAGE_PATTERN =
  /(?:bad gateway|eai_again|econnreset|etimedout|fetch failed|network error|service unavailable|socket hang up|und_err)/i;

export type StorefrontReadFailureKind =
  | 'database'
  | 'integrity'
  | 'timeout'
  | 'transport'
  | 'unknown';

export interface StorefrontReadFailure {
  code?: string;
  httpStatus?: number;
  kind: StorefrontReadFailureKind;
  operation: string;
  retryable: boolean;
}

export type StorefrontReadResult<T> =
  | { status: 'found'; value: T }
  | { status: 'not_found' }
  | { status: 'unavailable'; error: StorefrontReadFailure };

interface StorefrontReadResponse<T> {
  data: T | null;
  error: unknown;
  status?: number;
}

function readErrorField(error: unknown, field: string): unknown {
  return error && typeof error === 'object' ? Reflect.get(error, field) : null;
}

function normalizeErrorCode(error: unknown): string {
  const code = readErrorField(error, 'code');
  return typeof code === 'string' ? code.trim() : '';
}

function normalizeErrorText(error: unknown): string {
  return ['name', 'message', 'details']
    .map((field) => readErrorField(error, field))
    .filter((value): value is string => typeof value === 'string')
    .join('\n');
}

function classifyStorefrontReadFailure({
  error,
  operation,
  status,
}: {
  error: unknown;
  operation: string;
  status?: number;
}): StorefrontReadFailure {
  const code = normalizeErrorCode(error);
  const httpStatus = typeof status === 'number' && status > 0 ? status : null;

  if (TIMEOUT_ERROR_CODES.has(code)) {
    return {
      code,
      kind: 'timeout',
      operation,
      retryable: true,
      ...(httpStatus === null ? null : { httpStatus }),
    };
  }

  if (code === 'P0001') {
    return {
      code,
      kind: 'integrity',
      operation,
      retryable: false,
      ...(httpStatus === null ? null : { httpStatus }),
    };
  }

  // PostgREST connection/schema-cache failures (PGRST000-002, HTTP 503) are
  // transient transport, not authoritative database errors — classify them
  // before the stable-code branch below so they remain retryable.
  if (CONNECTION_ERROR_CODES.has(code) || httpStatus === 503) {
    return {
      code,
      kind: 'transport',
      operation,
      retryable: true,
      ...(httpStatus === null ? null : { httpStatus }),
    };
  }

  // Stable Postgres/PostgREST codes are authoritative. Message heuristics are
  // reserved for transport failures whose SDK error code is blank/numeric.
  if (DATABASE_ERROR_CODE_PATTERN.test(code)) {
    return {
      code,
      kind: 'database',
      operation,
      retryable: false,
      ...(httpStatus === null ? null : { httpStatus }),
    };
  }

  if (httpStatus !== null && RETRYABLE_HTTP_STATUSES.has(httpStatus)) {
    return {
      ...(code ? { code } : null),
      httpStatus,
      kind: 'transport',
      operation,
      retryable: true,
    };
  }

  const errorText = normalizeErrorText(error);
  if (TIMEOUT_MESSAGE_PATTERN.test(errorText)) {
    return {
      ...(code ? { code } : null),
      kind: 'timeout',
      operation,
      retryable: true,
      ...(httpStatus === null ? null : { httpStatus }),
    };
  }

  if (TRANSPORT_MESSAGE_PATTERN.test(errorText)) {
    return {
      ...(code ? { code } : null),
      kind: 'transport',
      operation,
      retryable: true,
      ...(httpStatus === null ? null : { httpStatus }),
    };
  }

  return {
    ...(code ? { code } : null),
    kind: 'unknown',
    operation,
    retryable: false,
    ...(httpStatus === null ? null : { httpStatus }),
  };
}

export function resolveStorefrontReadResult<TData, TValue>({
  operation,
  parse,
  response,
}: {
  operation: string;
  parse: (data: TData | null) => TValue | null;
  response: StorefrontReadResponse<TData>;
}): StorefrontReadResult<TValue> {
  if (response.error) {
    return {
      status: 'unavailable',
      error: classifyStorefrontReadFailure({
        error: response.error,
        operation,
        status: response.status,
      }),
    };
  }

  const value = parse(response.data);
  return value === null ? { status: 'not_found' } : { status: 'found', value };
}

export class StorefrontReadUnavailableError extends Error {
  readonly failure: StorefrontReadFailure;

  constructor(failure: StorefrontReadFailure) {
    super(`Storefront read unavailable: ${failure.operation}`);
    this.name = 'StorefrontReadUnavailableError';
    this.failure = failure;
  }
}

export function unwrapStorefrontReadResultForCache<T>(
  result: StorefrontReadResult<T>
): T | null {
  if (result.status === 'found') return result.value;
  if (result.status === 'not_found') return null;
  throw new StorefrontReadUnavailableError(result.error);
}
