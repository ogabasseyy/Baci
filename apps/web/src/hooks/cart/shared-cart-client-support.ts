import type {
  CartErrorCode,
  CartSnapshot,
  CartWarning,
} from '@baci/shared/cart';
import { isCartErrorCode } from '@baci/shared/cart';
export type SharedCartFetchResult =
  | { ok: true; snapshot: CartSnapshot; warnings: CartWarning[] }
  | {
      ok: false;
      code: CartErrorCode;
      snapshot: CartSnapshot | null;
      retryable: boolean;
    };

export type SharedCartMutationResult =
  | {
      ok: true;
      snapshot: CartSnapshot;
      replayed: boolean;
      warnings: CartWarning[];
    }
  | {
      ok: false;
      code: CartErrorCode;
      snapshot: CartSnapshot | null;
      retryable: boolean;
    };

export const RETRYABLE_CODES: ReadonlySet<CartErrorCode> = new Set([
  'rate_limited',
  'temporarily_unavailable',
]);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isSnapshot(value: unknown): value is CartSnapshot {
  return (
    isRecord(value) &&
    typeof value.cartId === 'string' &&
    typeof value.merchantId === 'string' &&
    typeof value.version === 'number' &&
    Array.isArray(value.lines)
  );
}

export function warningsOf(value: Record<string, unknown>): CartWarning[] {
  return Array.isArray(value.warnings) ? (value.warnings as CartWarning[]) : [];
}

/** The route validates this hint against its trusted host and proof. */
export function cartRoute(path: string, merchantSlug?: string | null): string {
  return merchantSlug
    ? `${path}?merchantSlug=${encodeURIComponent(merchantSlug)}`
    : path;
}

export async function readBody(
  response: Response
): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = await response.json();
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeErrorCode(
  value: unknown,
  fallback: CartErrorCode
): CartErrorCode {
  if (isCartErrorCode(value)) return value;
  switch (value) {
    case 'missing_proof':
    case 'invalid_proof':
    case 'expired_proof':
      return 'unauthorized';
    case 'merchant_unresolved':
    case 'merchant_mismatch':
      return 'merchant_unavailable';
    case 'invalid_request':
      return 'invalid_item';
    case 'quota_exceeded':
      return 'rate_limited';
    default:
      return fallback;
  }
}

export function failureOf(
  body: Record<string, unknown> | null,
  status: number,
  fallback: CartErrorCode = 'temporarily_unavailable'
): Extract<SharedCartFetchResult, { ok: false }> {
  const code = normalizeErrorCode(body?.code, fallback);
  const snapshot =
    body && isSnapshot(body.cart) ? (body.cart as CartSnapshot) : null;
  const retryable =
    status === 429 || status >= 500 || RETRYABLE_CODES.has(code);
  return { code, ok: false, retryable, snapshot };
}

export const UNAVAILABLE_FETCH: Extract<SharedCartFetchResult, { ok: false }> =
  {
    code: 'temporarily_unavailable',
    ok: false,
    retryable: true,
    snapshot: null,
  };
