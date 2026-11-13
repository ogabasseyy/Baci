import { escapeHtmlText } from '@/lib/sanitize';
import { sanitizeBlogImageCaptionText } from './blog-image-caption-sanitizer';
import { unescapeHtmlText } from './unescape-html-text';

const MAX_CAPTION_SANITIZE_LENGTH = 1000;

const GUARDRAIL_ITEMS = [
  'readable\\s+(?:text|interface(?:\\s+elements|\\s+chrome)?)',
  'interface\\s+elements',
  'interface\\s+chrome',
  'text',
  'logos',
  'watermarks',
  'brand\\s+marks',
  'gameplay\\s+screenshots',
  'test[\\s-]results?(?:\\s+claims)?',
  'invented\\s+product\\s+details',
  '(?:implied|simulated)\\s+hands-on\\s+testing',
  'fake\\s+packaging',
].join('|');

const GUARDRAIL_ITEM_CHAIN = `(?:${GUARDRAIL_ITEMS})(?:(?:,\\s*|\\s+(?:and|or)\\s+)(?:no\\s+)?(?:${GUARDRAIL_ITEMS}))*`;

const SPECIFIC_GUARDRAIL_PATTERNS = [
  'use\\s+(?:anatomically\\s+accurate|accurate\\s+official|approved\\s+hardware)[^.;<]*',
  `no\\s+${GUARDRAIL_ITEM_CHAIN}`,
  `omit\\s+${GUARDRAIL_ITEM_CHAIN}`,
  'keep\\s+screens\\s+free\\s+of\\s+readable\\s+text(?:\\s+and\\s+omit\\s+logos)?',
  `match\\s+official\\s+product\\s+references(?:\\s+and\\s+omit\\s+${GUARDRAIL_ITEM_CHAIN})?`,
  `avoid\\s+${GUARDRAIL_ITEM_CHAIN}`,
  `do\\s+not\\s+(?:include|render|show)\\s+${GUARDRAIL_ITEM_CHAIN}`,
  "components\\s+are\\s+conceptual(?:,\\s*not\\s+a\\s+depiction\\s+of\\s+this\\s+unit['’]s\\s+internal\\s+layout)?",
  'paperwork\\s+contains\\s+no\\s+readable\\s+text',
].join('|');

const CONTEXTUAL_PATTERNS = [
  SPECIFIC_GUARDRAIL_PATTERNS,
  'illustration\\s+without\\s+text(?:,\\s*logos|\\s+or\\s+logos|\\s+or\\s+fake\\s+packaging)*',
  'conceptual\\s+illustration(?:,\\s*not\\s+a\\s+(?:tested\\s+accessory\\s+setup|measured\\s+runtime\\s+test))?',
].join('|');

const HTML_GUARDRAIL_REGEX = new RegExp(
  `(?:([.;])?\\s*<([a-z0-9]+)[^>]*>\\s*(?:${CONTEXTUAL_PATTERNS})\\.?\\s*<\\/\\2>\\.?\\s*$|` +
    `([.;])\\s*(?:${CONTEXTUAL_PATTERNS})\\.?\\s*(?=(?:<\\/[a-z0-9]+>\\s*)+$)|` +
    `(?:^([.;])?\\s*(?:${SPECIFIC_GUARDRAIL_PATTERNS})|([.;])\\s+(?:${CONTEXTUAL_PATTERNS}))\\.?\\s*$)`,
  'i'
);

function hasBalancedTags(html: string): boolean {
  const tagRegex = /<\/?([a-z0-9]+)(?:\s+[^>]*)?(\/?)>/gi;
  const stack: string[] = [];
  const voidTags = new Set(['br', 'img', 'hr', 'input']);
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

/**
 * Sanitizes `<figcaption>` inner HTML, stripping leaked AI prompt directives
 * while preserving valid inline markup when balanced.
 */
export function sanitizeFigcaptionHtml(innerHtml: string): string {
  if (innerHtml.length > MAX_CAPTION_SANITIZE_LENGTH * 4) {
    return innerHtml;
  }
  const textContent = innerHtml.replace(/<[^>]*>/g, '');
  if (textContent.length > MAX_CAPTION_SANITIZE_LENGTH) {
    return innerHtml;
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
  const withoutPrefix = result.replace(
    /^((?:<[a-z0-9]+[^>]*>\s*)*)(?:planned\s+)?(?:editorial\s+|conceptual\s+)?(?:illustration|infographic|diagram|visual)(?:\s+concept)?\s*:\s*/i,
    '$1'
  );
  const prefixRemoved = withoutPrefix !== result;
  result = stripTrailingGuardrailsFromHtml(withoutPrefix);

  if (prefixRemoved) {
    result = result.replace(
      /^((?:<[a-z0-9]+[^>]*>\s*)*)([a-z])/i,
      (_match, tags, char) => `${tags}${char.toUpperCase()}`
    );
  }

  const resultingText = unescapeHtmlText(result.replace(/<[^>]*>/g, '')).trim();

  // If tags are balanced and text content matches sanitized text, keep inline markup;
  // otherwise fallback to safely escaped text to prevent malformed or unbalanced HTML.
  if (hasBalancedTags(result) && resultingText === cleanedText) {
    return result;
  }

  return escapeHtmlText(cleanedText);
}
