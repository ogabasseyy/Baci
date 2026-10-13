export type AnalyticsJson =
  | string
  | number
  | boolean
  | null
  | { [key: string]: AnalyticsJson }
  | AnalyticsJson[];

export type AnalyticsProperties = Record<string, AnalyticsJson>;

const REDACTED_VALUE = '[Filtered]';
const SENSITIVE_PROPERTY_TOKENS = new Set([
  'password',
  'passcode',
  'token',
  'secret',
  'authorization',
  'key',
  'credential',
  'credentials',
  'cookie',
  'otp',
  'pin',
  'cvv',
  'card',
  'bvn',
  'nin',
  'email',
  'phone',
  'address',
]);
const URL_PROPERTY_PATTERN = /(?:url|href|referrer|request_path|pathname)/i;
const QUERY_OR_HASH_PATTERN = /[?#]/;
const EMAIL_VALUE_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const SENSITIVE_NUMERIC_VALUE_PATTERNS = [
  /(?:\+\d[\d\s().-]{7,}\d|\b\d[\d\s().-]{7,}\d\b)/g,
  /\b(?:\d[ -]?){13,19}\b/g,
  /\b\d{11}\b/g,
] as const;
const SENSITIVE_TEXT_VALUE_PATTERNS = [
  /\b(?:otp|pin|passcode|verification code|security code)\D{0,12}\d{4,8}\b/gi,
] as const;
const SENSITIVE_VALUE_PATTERNS = [
  ...SENSITIVE_NUMERIC_VALUE_PATTERNS,
  ...SENSITIVE_TEXT_VALUE_PATTERNS,
] as const;
const IDENTIFIER_CONTEXT_TOKENS = new Set([
  'cart',
  'carts',
  'checkout',
  'notification',
  'notifications',
  'order',
  'orders',
  'payment',
  'payments',
  'product',
  'products',
  'shipment',
  'shipments',
  'transaction',
  'transactions',
  'variant',
  'variants',
]);
const IDENTIFIER_QUALIFIER_TOKENS = new Set([
  'id',
  'ids',
  'no',
  'number',
  'numbers',
  'ref',
  'reference',
  'references',
  'sku',
  'tracking',
]);
const SKU_IDENTIFIER_TOKEN = 'sku';
const BUSINESS_IDENTIFIER_VALUE_PATTERN =
  /^(?=.{3,128}$)(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9][A-Za-z0-9_.:-]*$/;
const NUMERIC_SKU_IDENTIFIER_VALUE_PATTERN = /^(?:\d{8}|\d{12,14})$/;
const UUID_VALUE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function removeUrlCredentials(value: string): string {
  try {
    const url = new URL(value);
    if (url.username || url.password) {
      url.username = '';
      url.password = '';
      return url.toString();
    }
  } catch {
    // Fall through to scheme-less sanitization.
  }

  return value
    .replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/?#@]+@/i, '$1')
    .replace(/^[^/?#@]+:[^/?#@]+@/, '');
}

function redactUrlQuery(value: string): string {
  const withoutCredentials = removeUrlCredentials(value);
  const markerIndex = withoutCredentials.search(QUERY_OR_HASH_PATTERN);
  return markerIndex === -1
    ? withoutCredentials
    : withoutCredentials.slice(0, markerIndex);
}

function redactSensitiveStringValues(
  value: string,
  options: { preserveBusinessIdentifier?: boolean } = {}
): string {
  const patterns: readonly RegExp[] = options.preserveBusinessIdentifier
    ? SENSITIVE_TEXT_VALUE_PATTERNS
    : SENSITIVE_VALUE_PATTERNS;

  return patterns.reduce(
    (sanitizedValue, pattern) =>
      sanitizedValue.replace(pattern, REDACTED_VALUE),
    value.replace(EMAIL_VALUE_PATTERN, REDACTED_VALUE)
  );
}

function getPropertyKeyTokens(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function isSensitivePropertyKey(key: string): boolean {
  return getPropertyKeyTokens(key).some(
    (token) =>
      SENSITIVE_PROPERTY_TOKENS.has(token) ||
      (token.endsWith('s') && SENSITIVE_PROPERTY_TOKENS.has(token.slice(0, -1)))
  );
}

function isKnownIdentifierPropertyKey(key: string): boolean {
  const tokens = getPropertyKeyTokens(key);

  if (tokens.length === 0) {
    return false;
  }

  if (
    tokens.length === 1 &&
    (tokens[0] === 'order' || tokens[0] === SKU_IDENTIFIER_TOKEN)
  ) {
    return true;
  }

  return (
    tokens.some((token) => IDENTIFIER_CONTEXT_TOKENS.has(token)) &&
    tokens.some((token) => IDENTIFIER_QUALIFIER_TOKENS.has(token))
  );
}

function isSkuIdentifierPropertyKey(key: string): boolean {
  return getPropertyKeyTokens(key).includes(SKU_IDENTIFIER_TOKEN);
}

function isBusinessIdentifierValue(key: string, value: string): boolean {
  const trimmed = value.trim();

  return (
    UUID_VALUE_PATTERN.test(trimmed) ||
    BUSINESS_IDENTIFIER_VALUE_PATTERN.test(trimmed) ||
    (isSkuIdentifierPropertyKey(key) &&
      NUMERIC_SKU_IDENTIFIER_VALUE_PATTERN.test(trimmed))
  );
}

function sanitizeAnalyticsPropertyValue(
  key: string,
  value: unknown,
  seen: Set<object>
): AnalyticsJson | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (isSensitivePropertyKey(key)) {
    return REDACTED_VALUE;
  }

  if (typeof value === 'string') {
    const sanitizedString = URL_PROPERTY_PATTERN.test(key)
      ? redactUrlQuery(value)
      : value;

    return redactSensitiveStringValues(sanitizedString, {
      preserveBusinessIdentifier:
        isKnownIdentifierPropertyKey(key) &&
        isBusinessIdentifierValue(key, sanitizedString),
    });
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value === 'boolean' || value === null) {
    return value;
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return undefined;
    }

    seen.add(value);
    const sanitized = value
      .map((item) => sanitizeAnalyticsPropertyValue(key, item, seen))
      .filter((item): item is AnalyticsJson => item !== undefined);
    seen.delete(value);
    return sanitized;
  }

  if (isRecord(value)) {
    return sanitizeAnalyticsProperties(value, seen);
  }

  return undefined;
}

export function sanitizeAnalyticsProperties(
  properties: Record<string, unknown> | undefined,
  seen = new Set<object>()
): AnalyticsProperties | undefined {
  if (!properties) {
    return undefined;
  }

  if (seen.has(properties)) {
    return undefined;
  }

  seen.add(properties);

  const sanitized = Object.fromEntries(
    Object.entries(properties)
      .map(([key, value]) => [
        key,
        sanitizeAnalyticsPropertyValue(key, value, seen),
      ])
      .filter(
        (entry): entry is [string, AnalyticsJson] => entry[1] !== undefined
      )
  );
  seen.delete(properties);

  return sanitized;
}

interface AnalyticsCaptureEventLike {
  properties?: Record<string, unknown>;
  $set?: Record<string, unknown>;
  $set_once?: Record<string, unknown>;
}

type SanitizedAnalyticsCaptureEvent<T extends AnalyticsCaptureEventLike> = Omit<
  T,
  '$set' | '$set_once' | 'properties'
> & {
  properties?: AnalyticsProperties;
  $set?: AnalyticsProperties;
  $set_once?: AnalyticsProperties;
};

export function sanitizeAnalyticsCaptureEvent<
  T extends AnalyticsCaptureEventLike,
>(event: T | null): SanitizedAnalyticsCaptureEvent<T> | null {
  if (!event) {
    return null;
  }

  return {
    ...event,
    properties: sanitizeAnalyticsProperties(event.properties),
    $set: sanitizeAnalyticsProperties(event.$set),
    $set_once: sanitizeAnalyticsProperties(event.$set_once),
  };
}
