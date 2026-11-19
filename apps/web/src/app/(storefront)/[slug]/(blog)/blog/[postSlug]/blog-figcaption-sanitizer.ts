import { escapeHtmlText } from '@/lib/sanitize';
import {
  CONTEXTUAL_PATTERNS,
  HTML_PROMPT_PREFIX_REGEX,
  MAX_CAPTION_SANITIZE_LENGTH,
  SPECIFIC_GUARDRAIL_PATTERNS,
} from './blog-caption-guardrail-patterns';
import { sanitizeBlogImageCaptionText } from './blog-image-caption-sanitizer';
import { unescapeHtmlText } from './unescape-html-text';

const HTML_GUARDRAIL_REGEX = new RegExp(
  `(?:([.;])?\\s*<([a-z0-9]+)[^>]*>\\s*(?:${CONTEXTUAL_PATTERNS})\\.?\\s*<\\/\\2>\\.?\\s*$|` +
    `([.;])\\s*(?:${CONTEXTUAL_PATTERNS})\\.?\\s*(?=(?:<\\/[a-z0-9]+>\\s*)+$)|` +
    `(?:^([.;])?\\s*(?:${SPECIFIC_GUARDRAIL_PATTERNS})|([.;])\\s+(?:${CONTEXTUAL_PATTERNS}))\\.?\\s*$)`,
  'i'
);

function hasBalancedTags(html: string): boolean {
  const tagRegex = /<\/?([a-z0-9]+)(?:\s+[^>]*)?(\/?)>/gi;
  const stack: string[] = [];
  const voidTags = new Set([
    'area',
    'base',
    'br',
    'col',
    'embed',
    'hr',
    'img',
    'input',
    'link',
    'meta',
    'source',
    'track',
    'wbr',
  ]);
  let match = tagRegex.exec(html);
  while (match !== null) {
    const fullTag = match[0];
    const tagName = match[1]?.toLowerCase();
    const isSelfClosing = match[2] === '/' || fullTag.endsWith('/>');
    if (!tagName || voidTags.has(tagName) || isSelfClosing) {
      match = tagRegex.exec(html);
      continue;
    }
    if (fullTag.startsWith('</')) {
      if (stack.length === 0 || stack[stack.length - 1] !== tagName) {
        return false;
      }
      stack.pop();
    } else {
      stack.push(tagName);
    }
    match = tagRegex.exec(html);
  }
  return stack.length === 0;
}

function stripTrailingGuardrailsFromHtml(input: string): string {
  let text = input;
  while (text) {
    const next = text
      .replace(HTML_GUARDRAIL_REGEX, (_match, p1, _p2, p3, p4, p5) => {
        const punct = p1 || p3 || p4 || p5;
        return punct ? '.' : '';
      })
      .replace(/<([a-z0-9]+)[^>]*>\s*<\/\1>\s*$/i, '')
      .trim();
    if (next === text) break;
    text = next;
  }
  return text;
}

function extractFigcaptionText(html: string): string {
  return html
    .replace(/<(?:br\s*\/?|\/?(?:p|div|li|blockquote|h[1-6]))\b[^>]*>/gi, ' ')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/[ \t\r\n]+/g, ' ');
}

/**
 * Sanitizes `<figcaption>` inner HTML, stripping leaked AI prompt directives
 * while preserving valid inline markup when balanced.
 */
export function sanitizeFigcaptionHtml(innerHtml: string): string {
  const textContent = extractFigcaptionText(
    innerHtml.slice(0, MAX_CAPTION_SANITIZE_LENGTH * 4)
  );
  if (
    innerHtml.length > MAX_CAPTION_SANITIZE_LENGTH * 4 ||
    textContent.length > MAX_CAPTION_SANITIZE_LENGTH
  ) {
    const boundedSanitized = sanitizeBlogImageCaptionText(
      unescapeHtmlText(textContent)
    );
    return boundedSanitized ? escapeHtmlText(boundedSanitized) : '';
  }

  const cleanedText = sanitizeBlogImageCaptionText(
    unescapeHtmlText(textContent)
  );
  if (!cleanedText) {
    return '';
  }

  // If plain text (no HTML tags), preserve original if unchanged to avoid entity round-trips
  if (!/<[a-z]/i.test(innerHtml)) {
    return cleanedText === unescapeHtmlText(textContent).trim()
      ? innerHtml.trim()
      : escapeHtmlText(cleanedText);
  }

  // If inner HTML contains inline markup, strip prompt directives from the markup
  let result = innerHtml.trim();
  const withoutPrefix = result.replace(HTML_PROMPT_PREFIX_REGEX, '$1');
  const prefixRemoved = withoutPrefix !== result;
  result = stripTrailingGuardrailsFromHtml(withoutPrefix);

  if (prefixRemoved) {
    result = result.replace(
      /^((?:<[a-z0-9]+[^>]*>\s*)*)(?!macOS\b|watchOS\b|tvOS\b|visionOS\b)([a-z])(?![A-Z])/,
      (_match, tags, char) => `${tags}${char.toUpperCase()}`
    );
  }

  const resultingText = unescapeHtmlText(extractFigcaptionText(result)).trim();

  // If tags are balanced and text content matches sanitized text, keep inline markup;
  // otherwise fallback to safely escaped text to prevent malformed or unbalanced HTML.
  if (hasBalancedTags(result) && resultingText === cleanedText) {
    return result;
  }

  return escapeHtmlText(cleanedText);
}
