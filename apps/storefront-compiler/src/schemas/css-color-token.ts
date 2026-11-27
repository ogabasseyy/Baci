import { z } from 'zod';

const FORBIDDEN_CSS_TOKEN_CHARS_RE = /[;{}<>\\"'`]/;
const HEX_COLOR_RE =
  /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

const NUM = '(?:[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+))';
const PCT = `${NUM}%`;
const ANG = `${NUM}(?:deg|rad|grad|turn)?`;
const ALPHA = `${NUM}%?`;

const MODERN_RGB_RE = new RegExp(
  `^rgba?\\(\\s*(?:${NUM}%?|none)\\s+(?:${NUM}%?|none)\\s+(?:${NUM}%?|none)(?:\\s*\\/\\s*(?:${ALPHA}|none))?\\s*\\)$`,
  'i'
);
const LEGACY_RGB_NUM_RE = new RegExp(
  `^rgba?\\(\\s*${NUM}\\s*,\\s*${NUM}\\s*,\\s*${NUM}(?:\\s*,\\s*${ALPHA})?\\s*\\)$`,
  'i'
);
const LEGACY_RGB_PCT_RE = new RegExp(
  `^rgba?\\(\\s*${PCT}\\s*,\\s*${PCT}\\s*,\\s*${PCT}(?:\\s*,\\s*${ALPHA})?\\s*\\)$`,
  'i'
);
const MODERN_HSL_RE = new RegExp(
  `^hsla?\\(\\s*(?:${ANG}|none)\\s+(?:${NUM}%?|none)\\s+(?:${NUM}%?|none)(?:\\s*\\/\\s*(?:${ALPHA}|none))?\\s*\\)$`,
  'i'
);
const LEGACY_HSL_RE = new RegExp(
  `^hsla?\\(\\s*${ANG}\\s*,\\s*${PCT}\\s*,\\s*${PCT}(?:\\s*,\\s*${ALPHA})?\\s*\\)$`,
  'i'
);
const OKLCH_RE = new RegExp(
  `^oklch\\(\\s*(?:${NUM}%?|none)\\s+(?:${NUM}%?|none)\\s+(?:${ANG}|none)(?:\\s*\\/\\s*(?:${ALPHA}|none))?\\s*\\)$`,
  'i'
);

export function isValidCssColorToken(value: string): boolean {
  if (
    FORBIDDEN_CSS_TOKEN_CHARS_RE.test(value) ||
    value.includes('/*') ||
    value.includes('*/')
  ) {
    return false;
  }
  return (
    HEX_COLOR_RE.test(value) ||
    MODERN_RGB_RE.test(value) ||
    LEGACY_RGB_NUM_RE.test(value) ||
    LEGACY_RGB_PCT_RE.test(value) ||
    MODERN_HSL_RE.test(value) ||
    LEGACY_HSL_RE.test(value) ||
    OKLCH_RE.test(value)
  );
}

export const cssColorTokenSchema = z
  .string()
  .trim()
  .min(4)
  .max(64)
  .refine(
    isValidCssColorToken,
    'Theme token must be a valid CSS Color 4 hex, rgb/rgba, hsl/hsla, or oklch color'
  );
