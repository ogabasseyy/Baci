// JSON-LD Sanitization Utilities
// Safe escaping and sanitization for structured data (JSON-LD) schemas

import { replaceLoneSurrogates } from './replace-lone-surrogates';
import { escapeHtml, sanitizeUrl } from './sanitize-core';

export { safeJsonLdStringify } from './json-ld-script-escape';

/**
 * Validate and normalize a URL for use in JSON-LD schemas.
 * Script-context escaping is handled by safeJsonLdStringify().
 */
export function sanitizeSchemaUrl(url: string): string {
  const sanitized = sanitizeUrl(url);
  if (!sanitized) return '';
  return sanitized;
}

/**
 * Recursively sanitize all string values in a JSON-LD schema object.
 * This prevents XSS when rendering schema_markup from the database.
 * Performance: O(n) where n is total number of values, with minimal memory overhead.
 */
export function sanitizeSchemaMarkup<T>(obj: T): T {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'string') {
    return escapeHtml(replaceLoneSurrogates(obj)) as T;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeSchemaMarkup(item)) as T;
  }

  if (typeof obj === 'object') {
    const result: Record<string, unknown> = Object.create(null);
    for (const key in obj) {
      if (Object.hasOwn(obj, key)) {
        result[replaceLoneSurrogates(key)] = sanitizeSchemaMarkup(
          (obj as Record<string, unknown>)[key]
        );
      }
    }
    return result as T;
  }

  // Numbers, booleans, etc. pass through unchanged
  return obj;
}
