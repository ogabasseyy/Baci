// Core Sanitization Utilities (No DOMPurify dependency)
// These functions are safe to use in Server Components without triggering jsdom loading
// For HTML sanitization that requires DOMPurify, use sanitize.ts instead
// For JSON-LD sanitization, use sanitize-json-ld.ts

// Pre-compiled Regexes for Performance
const HTML_TAG_REGEX = /<[^>]{0,1000}>/g;
const NULL_BYTE_REGEX = /\0/g;
const PHONE_SANITIZATION_REGEX = /[^\d+\-\s()]/g;
const SEARCH_QUERY_SANITIZATION_REGEX = /[<>'"`;\\,()|]/g;
const LOG_CONTROL_CHARS_REGEX = /[\r\n\t]/g;
const LOG_NON_PRINTABLE_REGEX = /[^\x20-\x7E]/g;
const LIKE_ESCAPE_REGEX = /[\\%_]/g;
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FILENAME_TRAVERSAL_REGEX = /\.\./g;
const FILENAME_SANITIZATION_REGEX = /[^a-zA-Z0-9._-]/g;
const HTML_ESCAPE_REGEX = /[&<>"']/g;

const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '\\u0026',
  '<': '\\u003c',
  '>': '\\u003e',
  '"': '\\u0022',
  "'": '\\u0027',
};

const LIKE_ESCAPE_MAP: Record<string, string> = {
  '\\': '\\\\',
  '%': '\\%',
  _: '\\_',
};

/**
 * Strips HTML tags from a string by iteratively applying the regex until no more matches.
 * This prevents incomplete sanitization from nested patterns like <scr<script>ipt>.
 */
export function stripHtmlTags(text: string | null | undefined): string {
  if (text == null) return '';

  const maxLength = 100000;
  const truncated = text.length > maxLength ? text.slice(0, maxLength) : text;

  // Fast path: skip regex overhead when no HTML tags are present
  if (!truncated.includes('<')) {
    return truncated;
  }

  let result = truncated;
  let previous: string;
  let iterations = 0;
  const maxIterations = 10;

  do {
    previous = result;
    result = result.replace(HTML_TAG_REGEX, '');
    iterations++;
  } while (result !== previous && iterations < maxIterations);

  return result;
}

/**
 * Sanitize plain text (remove HTML, trim, limit length)
 */
export function sanitizeText(text: string, maxLength: number = 10000): string {
  if (!text) return '';

  let sanitized = text.replace(NULL_BYTE_REGEX, '');
  sanitized = stripHtmlTags(sanitized);
  sanitized = sanitized.trim();

  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }

  return sanitized;
}

/**
 * Sanitize email address
 */
export function sanitizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

/**
 * Sanitize a header-adjacent display name: strip line breaks that could
 * smuggle extra headers, then cap the length.
 */
export function sanitizeEmailDisplayName(name: string): string {
  return name
    .replace(/[\r\n]/g, '')
    .trim()
    .slice(0, 128);
}

/**
 * Sanitize phone number (remove non-numeric characters except +)
 */
export function sanitizePhone(phone: string): string {
  return phone.replace(PHONE_SANITIZATION_REGEX, '').trim();
}

/**
 * Sanitize URL
 */
export function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return '';
    }
    return parsed.toString();
  } catch {
    return '';
  }
}

/**
 * Escape HTML-sensitive characters using Unicode escape sequences.
 * Used in JSON-LD scripts and form output to prevent XSS.
 */
export function escapeHtml(str: string): string {
  if (!str) return '';
  return str.replace(HTML_ESCAPE_REGEX, (match) => HTML_ESCAPE_MAP[match]);
}

/**
 * Sanitize number input
 */
export function sanitizeNumber(value: unknown): number {
  const num = Number(value);
  return Number.isNaN(num) ? 0 : num;
}

/**
 * Sanitize integer input
 */
export function sanitizeInteger(value: unknown): number {
  const num = sanitizeNumber(value);
  return Number.isFinite(num) ? Math.floor(num) : 0;
}

/**
 * Sanitize price (ensure 2 decimal places, positive)
 */
export function sanitizePrice(value: unknown): number {
  const num = sanitizeNumber(value);
  return Math.max(0, Math.round(num * 100) / 100);
}

/**
 * Sanitize object keys to prevent prototype pollution
 */
export function sanitizeObjectKeys<T extends Record<string, unknown>>(
  obj: T
): T {
  const sanitized: Record<string, unknown> = {};

  for (const key in obj) {
    if (!Object.hasOwn(obj, key)) continue;
    if (['__proto__', 'constructor', 'prototype'].includes(key)) continue;
    sanitized[key] = obj[key];
  }

  return sanitized as T;
}

/**
 * Sanitize search query
 */
export function sanitizeSearchQuery(query: string): string {
  let sanitized = query.replace(SEARCH_QUERY_SANITIZATION_REGEX, '');
  sanitized = sanitized.trim().substring(0, 200);
  return sanitized;
}

/** Strip control chars and non-printable characters for safe logging */
function cleanForLog(str: string): string {
  return str
    .replace(LOG_CONTROL_CHARS_REGEX, ' ')
    .replace(LOG_NON_PRINTABLE_REGEX, '');
}

/**
 * Sanitize user-provided values for safe logging.
 * Prevents log injection attacks by removing control characters.
 */
export function sanitizeForLog(value: unknown, maxLength = 1000): string {
  try {
    if (value === undefined || value === null) return '';

    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      return cleanForLog(String(value).slice(0, maxLength));
    }

    const json = JSON.stringify(value);
    return cleanForLog(
      (json === undefined ? String(value) : json).slice(0, maxLength)
    );
  } catch {
    return cleanForLog(String(value ?? '').slice(0, maxLength));
  }
}

/**
 * Sanitize SQL LIKE pattern
 */
export function sanitizeLikePattern(pattern: string): string {
  return pattern.replace(LIKE_ESCAPE_REGEX, (match) => LIKE_ESCAPE_MAP[match]);
}

/**
 * Validate UUID format
 */
export function isValidUuid(uuid: string): boolean {
  return UUID_REGEX.test(uuid);
}

/**
 * Sanitize file name
 */
export function sanitizeFileName(fileName: string): string {
  let sanitized = fileName.replace(FILENAME_TRAVERSAL_REGEX, '');
  sanitized = sanitized.replace(FILENAME_SANITIZATION_REGEX, '_');
  sanitized = sanitized.substring(0, 255);
  return sanitized;
}
