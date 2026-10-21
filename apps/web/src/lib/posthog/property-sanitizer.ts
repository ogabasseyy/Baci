import type { Properties } from 'posthog-js';
import { sanitizePostHogExceptionText } from '@/lib/posthog/exception-text';

export const REDACTED_VALUE = '[Filtered]';
export const QUERY_OR_HASH_PATTERN = /[?#]/;

const SENSITIVE_PROPERTY_TOKENS = new Set([
  'password',
  'passcode',
  'token',
  'secret',
  'authorization',
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
const URL_PROPERTY_PATTERN =
  /(?:url|href|referrer|current_url|pathname|request_path)/i;
const AUTOCAPTURE_TEXT_PROPERTY_PATTERN =
  /^(?:\$el_text|\$elements_chain|text|attr__(?:aria-label|placeholder|title))$/i;
const EMAIL_VALUE_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const EXCEPTION_LIST_PROPERTY_KEY = '$exception_list';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function redactUrlQuery(value: string): string {
  const markerIndex = value.search(QUERY_OR_HASH_PATTERN);
  return markerIndex === -1 ? value : value.slice(0, markerIndex);
}

function isSensitivePropertyKey(key: string): boolean {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .some((token) => SENSITIVE_PROPERTY_TOKENS.has(token));
}

function sanitizeExceptionListValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return sanitizePostHogExceptionText(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeExceptionListValue(item));
  }

  if (isRecord(value)) {
    const sanitized = Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        sanitizeExceptionListValue(entryValue),
      ])
    );

    return sanitizePostHogProperties(sanitized);
  }

  return value;
}

function sanitizePropertyValue(key: string, value: unknown): unknown {
  if (key === EXCEPTION_LIST_PROPERTY_KEY) {
    return sanitizeExceptionListValue(value);
  }

  if (AUTOCAPTURE_TEXT_PROPERTY_PATTERN.test(key)) {
    return REDACTED_VALUE;
  }

  if (isSensitivePropertyKey(key)) {
    return REDACTED_VALUE;
  }

  if (typeof value === 'string') {
    if (URL_PROPERTY_PATTERN.test(key)) {
      return redactUrlQuery(value);
    }

    return value.replace(EMAIL_VALUE_PATTERN, REDACTED_VALUE);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizePropertyValue(key, item));
  }

  if (isRecord(value)) {
    return sanitizePostHogProperties(value);
  }

  return value;
}

export function sanitizePostHogProperties(
  properties: Record<string, unknown> | undefined
): Properties | undefined {
  if (!properties) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(properties).map(([key, value]) => [
      key,
      sanitizePropertyValue(key, value),
    ])
  ) as Properties;
}
