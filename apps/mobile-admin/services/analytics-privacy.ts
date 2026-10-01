export type AdminAnalyticsJson =
  | string
  | number
  | boolean
  | null
  | { [key: string]: AdminAnalyticsJson }
  | AdminAnalyticsJson[];

export type AdminAnalyticsProperties = Record<string, AdminAnalyticsJson>;

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
  'account',
  'bank',
]);
const URL_PROPERTY_PATTERN = /(?:url|href|referrer|request_path|pathname)/i;
const QUERY_OR_HASH_PATTERN = /[?#]/;
const URL_VALUE_PATTERN =
  /\bhttps?:\/\/[^\s"'<>()[\]{}]+|(^|[\s"'(])\/\/[^\s"'<>()[\]{}]+/gi;
const EMAIL_VALUE_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const SENSITIVE_VALUE_PATTERNS = [
  /(?:\+\d[\d\s().-]{7,}\d|\b\d[\d\s().-]{7,}\d\b)/g,
  /\b(?:\d[ -]?){13,19}\b/g,
  /\b\d{11}\b/g,
  /\b(?:otp|pin|passcode|verification code|security code)\D{0,12}\d{4,8}\b/gi,
] as const;
const BUSINESS_IDENTIFIER_CONTEXT_TOKENS = new Set([
  'customer',
  'merchant',
  'order',
  'payment',
  'product',
  'shipment',
  'staff',
  'transaction',
  'variant',
]);
const OPAQUE_BUSINESS_IDENTIFIER_PROPERTY_KEYS = new Set(['signup_attempt_id']);
const BUSINESS_IDENTIFIER_QUALIFIER_TOKENS = new Set([
  'id',
  'ids',
  'no',
  'number',
  'ref',
  'reference',
  'tracking',
]);

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
    .replace(/^(\/\/)[^/?#@]+@/, '$1')
    .replace(/^[^/?#@]+:[^/?#@]+@/, '');
}

function redactUrlQuery(value: string): string {
  const withoutCredentials = removeUrlCredentials(value);
  const markerIndex = withoutCredentials.search(QUERY_OR_HASH_PATTERN);
  return markerIndex === -1
    ? withoutCredentials
    : withoutCredentials.slice(0, markerIndex);
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

function isBusinessIdentifierPropertyKey(key: string): boolean {
  const tokens = getPropertyKeyTokens(key);
  return (
    OPAQUE_BUSINESS_IDENTIFIER_PROPERTY_KEYS.has(tokens.join('_')) ||
    (tokens.some((token) => BUSINESS_IDENTIFIER_CONTEXT_TOKENS.has(token)) &&
      tokens.some((token) => BUSINESS_IDENTIFIER_QUALIFIER_TOKENS.has(token)))
  );
}

function redactSensitiveStringValues(key: string, value: string): string {
  const preservesIdentifier = isBusinessIdentifierPropertyKey(key);
  const patterns = preservesIdentifier ? [] : SENSITIVE_VALUE_PATTERNS;

  return patterns.reduce(
    (sanitizedValue, pattern) =>
      sanitizedValue.replace(pattern, REDACTED_VALUE),
    value.replace(EMAIL_VALUE_PATTERN, REDACTED_VALUE)
  );
}

function stripSensitiveUrlParts(value: string): string {
  return value.replace(URL_VALUE_PATTERN, (match, prefix?: string) => {
    if (prefix === undefined) {
      return redactUrlQuery(match);
    }

    return `${prefix}${redactUrlQuery(match.slice(prefix.length))}`;
  });
}

export function sanitizeAdminAnalyticsText(value: string): string {
  return redactSensitiveStringValues('', stripSensitiveUrlParts(value));
}

function sanitizeAdminAnalyticsPropertyValue(
  key: string,
  value: unknown,
  seen: Set<object>
): AdminAnalyticsJson | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (isSensitivePropertyKey(key)) {
    return REDACTED_VALUE;
  }

  if (typeof value === 'string') {
    const sanitizedString = URL_PROPERTY_PATTERN.test(key)
      ? redactUrlQuery(value)
      : stripSensitiveUrlParts(value);
    return redactSensitiveStringValues(key, sanitizedString);
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
      .map((item) => sanitizeAdminAnalyticsPropertyValue(key, item, seen))
      .filter((item): item is AdminAnalyticsJson => item !== undefined);
    seen.delete(value);
    return sanitized;
  }

  if (isRecord(value)) {
    return sanitizeAdminAnalyticsProperties(value, seen);
  }

  return undefined;
}

export function sanitizeAdminAnalyticsProperties(
  properties: Record<string, unknown> | undefined,
  seen = new Set<object>()
): AdminAnalyticsProperties | undefined {
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
        sanitizeAdminAnalyticsPropertyValue(key, value, seen),
      ])
      .filter(
        (entry): entry is [string, AdminAnalyticsJson] => entry[1] !== undefined
      )
  );
  seen.delete(properties);

  return sanitized;
}

interface AdminAnalyticsCaptureEventLike {
  properties?: Record<string, unknown>;
  $set?: Record<string, unknown>;
  $set_once?: Record<string, unknown>;
}

type SanitizedAdminAnalyticsCaptureEvent<
  T extends AdminAnalyticsCaptureEventLike,
> = Omit<T, '$set' | '$set_once' | 'properties'> & {
  properties?: AdminAnalyticsProperties;
  $set?: AdminAnalyticsProperties;
  $set_once?: AdminAnalyticsProperties;
};

export function sanitizeAdminAnalyticsCaptureEvent<
  T extends AdminAnalyticsCaptureEventLike,
>(event: T | null): SanitizedAdminAnalyticsCaptureEvent<T> | null {
  if (!event) {
    return null;
  }

  return {
    ...event,
    properties: sanitizeAdminAnalyticsProperties(event.properties),
    $set: sanitizeAdminAnalyticsProperties(event.$set),
    $set_once: sanitizeAdminAnalyticsProperties(event.$set_once),
  };
}
