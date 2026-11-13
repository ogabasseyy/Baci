import {
  CONTEXTUAL_PATTERNS,
  MAX_CAPTION_SANITIZE_LENGTH,
  PROMPT_PREFIX_REGEX,
  SPECIFIC_GUARDRAIL_PATTERNS,
} from './blog-caption-guardrail-patterns';

const TRAILING_GUARDRAIL_CLAUSE_REGEX = new RegExp(
  `(?:^([.;])?\\s*(?:${SPECIFIC_GUARDRAIL_PATTERNS})|([.;])\\s+(?:${CONTEXTUAL_PATTERNS}))\\.?\\s*$`,
  'i'
);

function stripTrailingGuardrails(input: string): string {
  let text = input;
  while (text) {
    const next = text
      .replace(TRAILING_GUARDRAIL_CLAUSE_REGEX, (_match, p1, p2) => {
        const punct = p1 || p2;
        return punct ? '.' : '';
      })
      .trim();
    if (next === text) break;
    text = next;
  }
  return text;
}

/**
 * Strips leaked AI image-generation prompt prefixes and trailing guardrail clauses
 * from plain caption text.
 */
export function sanitizeBlogImageCaptionText(rawCaption: string): string {
  if (!rawCaption) return '';

  let text = rawCaption.trim();
  if (!text) return '';

  if (text.length > MAX_CAPTION_SANITIZE_LENGTH * 2) {
    text = text.slice(0, MAX_CAPTION_SANITIZE_LENGTH * 2).trim();
  }

  const withoutPrefix = text.replace(PROMPT_PREFIX_REGEX, '').trim();
  const prefixRemoved = withoutPrefix !== text;
  text = stripTrailingGuardrails(withoutPrefix);

  if (text.length > MAX_CAPTION_SANITIZE_LENGTH) {
    text = text.slice(0, MAX_CAPTION_SANITIZE_LENGTH).trim();
  }

  if (!text) return '';

  // Capitalize the first letter only when a prompt prefix was stripped and it
  // does not start a camelCase brand name like "iPhone", "iPad", or "macOS".
  if (prefixRemoved) {
    text = text.replace(
      /^(?!macOS\b|watchOS\b|tvOS\b|visionOS\b)[a-z](?![A-Z])/,
      (char) => char.toUpperCase()
    );
  }
  return text.trim();
}
