import { replaceLoneSurrogates } from './replace-lone-surrogates';

const JSON_LD_SCRIPT_ESCAPE_REGEX = /[<>&\u2028\u2029]/g;

const JSON_LD_SCRIPT_ESCAPE_MAP: Record<string, string> = {
  '<': '\\u003c',
  '>': '\\u003e',
  '&': '\\u0026',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029',
};

/**
 * Safely stringify a JSON-LD schema object for use in script tags.
 *
 * Escape the serialized JSON for the HTML script context while preserving
 * valid data values and repairing malformed lone surrogates for parsers,
 * including structured-data crawlers.
 *
 * Deliberately dependency-free (beyond the surrogate fixer): this is the
 * hot path for storefront JSON-LD and speculation rules, which render on
 * every page. Importing the full HTML sanitizer here would drag
 * `sanitize-core` and the `sanitize-html` toolchain into the early client
 * bundle. Heavy schema scrubbing lives in `sanitize-json-ld.ts`.
 */
export function safeJsonLdStringify(schema: unknown): string {
  const serialized = JSON.stringify(schema, (_key, value) => {
    if (typeof value === 'string') {
      return replaceLoneSurrogates(value);
    }

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const repaired: Record<string, unknown> = Object.create(null);
      for (const [key, propertyValue] of Object.entries(value)) {
        repaired[replaceLoneSurrogates(key)] = propertyValue;
      }
      return repaired;
    }

    return value;
  });

  if (serialized === undefined) return '';

  return serialized.replace(
    JSON_LD_SCRIPT_ESCAPE_REGEX,
    (match) => JSON_LD_SCRIPT_ESCAPE_MAP[match] ?? match
  );
}
