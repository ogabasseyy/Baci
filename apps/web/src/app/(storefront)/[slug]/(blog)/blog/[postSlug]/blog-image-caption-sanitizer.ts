const MAX_CAPTION_SANITIZE_LENGTH = 1000;

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

  if (text.length > MAX_CAPTION_SANITIZE_LENGTH) {
    text = text.slice(0, MAX_CAPTION_SANITIZE_LENGTH).trim();
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
