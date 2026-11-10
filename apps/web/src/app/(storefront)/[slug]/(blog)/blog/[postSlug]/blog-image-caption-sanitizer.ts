import { escapeHtmlText } from '@/lib/sanitize';

const MAX_CAPTION_SANITIZE_LENGTH = 1000;

const HTML_TEXT_UNESCAPE_REGEX =
  /&(?:amp|lt|gt|quot|apos|#39|nbsp|copy|reg|trade|mdash|ndash|hellip|lsquo|rsquo|ldquo|rdquo|#\d+|#x[\da-f]+);/gi;
const HTML_TEXT_UNESCAPE_ENTITIES =
  "&amp;=&|&lt;=<|&gt;=>|&quot;=\"|&apos;='|&#39;='|&nbsp;=\u00a0|&copy;=\u00a9|&reg;=\u00ae|&trade;=\u2122|&mdash;=\u2014|&ndash;=\u2013|&hellip;=\u2026|&lsquo;=\u2018|&rsquo;=\u2019|&ldquo;=\u201c|&rdquo;=\u201d";
const HTML_TEXT_UNESCAPE_MAP: Record<string, string> = Object.fromEntries(
  HTML_TEXT_UNESCAPE_ENTITIES.split('|').map((entry) => {
    const separatorIndex = entry.indexOf('=');
    return [entry.slice(0, separatorIndex), entry.slice(separatorIndex + 1)];
  })
);

export function unescapeHtmlText(value: string): string {
  if (!value) return '';
  return value.replace(HTML_TEXT_UNESCAPE_REGEX, (match) => {
    const normalizedMatch = match.toLowerCase();
    const mapped = HTML_TEXT_UNESCAPE_MAP[normalizedMatch];
    if (mapped !== undefined) {
      return mapped;
    }

    if (normalizedMatch.startsWith('&#x')) {
      const codePoint = Number.parseInt(normalizedMatch.slice(3, -1), 16);
      return Number.isInteger(codePoint) && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : match;
    }

    if (normalizedMatch.startsWith('&#')) {
      const codePoint = Number.parseInt(normalizedMatch.slice(2, -1), 10);
      return Number.isInteger(codePoint) && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : match;
    }

    return match;
  });
}

const PROMPT_PREFIX_REGEX =
  /^(?:planned\s+)?(?:editorial\s+|conceptual\s+)?(?:illustration|infographic|diagram|visual)(?:\s+concept)?\s*:\s*/i;

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

const TRAILING_GUARDRAIL_CLAUSE_REGEX = new RegExp(
  `(?:^([.;])?\\s*(?:${SPECIFIC_GUARDRAIL_PATTERNS})|([.;])\\s+(?:${CONTEXTUAL_PATTERNS}))\\.?\\s*$`,
  'i'
);

const HTML_GUARDRAIL_REGEX = new RegExp(
  `(?:([.;])?\\s*<([a-z0-9]+)[^>]*>\\s*(?:${CONTEXTUAL_PATTERNS})\\.?\\s*<\\/\\2>\\.?\\s*$|` +
    `([.;])\\s*(?:${CONTEXTUAL_PATTERNS})\\.?\\s*(?=(?:<\\/[a-z0-9]+>\\s*)+$)|` +
    `(?:^([.;])?\\s*(?:${SPECIFIC_GUARDRAIL_PATTERNS})|([.;])\\s+(?:${CONTEXTUAL_PATTERNS}))\\.?\\s*$)`,
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

export function sanitizeBlogImageCaptionText(rawCaption: string): string {
  if (!rawCaption) return '';

  let text = rawCaption.trim();
  if (!text) return '';

  if (text.length > MAX_CAPTION_SANITIZE_LENGTH) {
    return text;
  }

  const withoutPrefix = text.replace(PROMPT_PREFIX_REGEX, '').trim();
  const prefixRemoved = withoutPrefix !== text;
  text = stripTrailingGuardrails(withoutPrefix);

  if (!text) return '';

  // Capitalize the first letter only when a prompt prefix was stripped,
  // preserving brand casing for names like "iPhone", "iPad", or "macOS".
  if (prefixRemoved) {
    text = text.charAt(0).toUpperCase() + text.slice(1);
  }
  return text.trim();
}

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

export function findTitleAttribute(
  imgTag: string
): { start: number; end: number; value: string } | null {
  const attributeRegex =
    /\s+([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|[^\s"'<>]+))?/g;
  const firstSpaceIndex = imgTag.indexOf(' ');
  if (firstSpaceIndex === -1) {
    return null;
  }
  attributeRegex.lastIndex = firstSpaceIndex;
  let match = attributeRegex.exec(imgTag);
  while (match !== null) {
    if (match[1]?.toLowerCase() === 'title') {
      return {
        start: match.index,
        end: match.index + match[0].length,
        value: match[2] ?? match[3] ?? '',
      };
    }
    match = attributeRegex.exec(imgTag);
  }
  return null;
}
