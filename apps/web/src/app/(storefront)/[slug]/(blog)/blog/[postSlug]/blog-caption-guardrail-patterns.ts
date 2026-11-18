export const MAX_CAPTION_SANITIZE_LENGTH = 1000;

export const PROMPT_PREFIX_REGEX =
  /^(?:planned\s+)?(?:editorial\s+|conceptual\s+)?(?:illustration|infographic|diagram|visual)(?:\s+concept)?\s*:\s*/i;

export const HTML_PROMPT_PREFIX_REGEX = new RegExp(
  `^((?:<[a-z0-9]+[^>]*>\\s*)*)${PROMPT_PREFIX_REGEX.source.slice(1)}`,
  'i'
);

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

export const SPECIFIC_GUARDRAIL_PATTERNS = [
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

export const CONTEXTUAL_PATTERNS = [
  SPECIFIC_GUARDRAIL_PATTERNS,
  'illustration\\s+without\\s+text(?:,\\s*logos|\\s+or\\s+logos|\\s+or\\s+fake\\s+packaging)*',
  'conceptual\\s+illustration(?:,\\s*not\\s+a\\s+(?:tested\\s+accessory\\s+setup|measured\\s+runtime\\s+test))?',
].join('|');
