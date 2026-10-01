import { canonicalizeDiscoveryProductType } from '../src/schemas/canonical-discovery-product-type';
import type { McpDiscoveryIntent } from '../src/schemas/mcp-discovery-intent';

const NUMERIC_UNITS: Record<string, string> = {
  storage_gb: 'GB', ram_gb: 'GB', power_w: 'W', screen_inches: 'inch', refresh_hz: 'Hz',
};
// Retrieval text stays small so it never needs truncation, which could split
// tsquery syntax. Dropping trailing terms only broadens recall; the structured
// matcher still enforces every constraint.
const MAX_TERMS_PER_GROUP = 12;
// Plain-language connectives are required lexemes under to_tsquery (only '|'
// is OR), so the fallback path drops them instead of collapsing recall.
const FALLBACK_STOPWORDS = new Set(['or', 'and', 'a', 'the']);
// Selection treats every spelling here as the same type (canonical aliases
// plus the narrow category fallback), so retrieval must too: the simple
// configuration does not stem, and a document carrying only 'smartphones'
// would otherwise never match intent 'phone'.
const TYPE_RETRIEVAL_SPELLINGS: Record<string, string[]> = {
  phone: ['phone', 'phones', 'smartphone', 'smartphones', 'smart_phone', 'smart_phones',
    'mobile_phone', 'mobile_phones', 'cell_phone', 'cell_phones'],
  laptop: ['laptop', 'laptops'],
  tablet: ['tablet', 'tablets'],
  charger: ['charger', 'chargers'],
  cable: ['cable', 'cables'],
  security_camera: ['security_camera', 'security_cameras'],
  fragrance_diffuser: ['fragrance_diffuser', 'fragrance_diffusers'],
};

function sanitizeTerm(value: string): string[] {
  // Dots survive inside version-like lexemes ('1.5' parses), but a dot-only
  // term voids the whole group server-side, so strip edge dots and drop terms
  // with no letters or numbers.
  return value.toLowerCase().replace(/[^\p{L}\p{N}.\s]+/gu, ' ').split(/\s+/)
    .map((term) => term.replace(/^\.+|\.+$/g, ''))
    .filter((term) => /[\p{L}\p{N}]/u.test(term));
}

function attributeTerms(key: string, value: string | number): string[] {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return [];
    const unit = NUMERIC_UNITS[key];
    return [`${value}${unit ?? ''}`.toLowerCase()];
  }
  return sanitizeTerm(value);
}

// Ranges cannot be tsquery terms, but the combined document carries unit
// lexemes (gb, w, inch, hz) for every numeric spec, so a range retrieves
// documents that have any value in those units and the matcher enforces the
// bound. (Attribute keys themselves are not indexed, only values and units.)
function rangeTerms(key: string, value: string | number): string[] {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return [];
  const unit = NUMERIC_UNITS[key];
  return unit ? [unit.toLowerCase()] : [];
}

function groupQuery(terms: string[]): string | undefined {
  if (terms.length === 0) return undefined;
  return `(${terms.slice(0, MAX_TERMS_PER_GROUP).join(' & ')})`;
}

function typeTerms(productType: string): string[] {
  const spellings = TYPE_RETRIEVAL_SPELLINGS[canonicalizeDiscoveryProductType(productType)];
  if (!spellings) return sanitizeTerm(productType);
  const branches = spellings.flatMap((spelling) => {
    const branch = groupQuery(sanitizeTerm(spelling));
    return branch ? [branch] : [];
  });
  if (branches.length === 0) return sanitizeTerm(productType);
  return [`(${branches.join(' | ')})`];
}

/** tsquery text for the facts index, built from structured alternatives so
 * shopper wording never constrains candidate recall. Groups join with OR and
 * terms with AND, matching the matcher's branch semantics; ranges retrieve
 * by unit lexeme while the matcher enforces the bound. */
export function buildDiscoveryFactRetrievalQuery(intent: McpDiscoveryIntent, fallbackQuery = ''): string {
  const groups: string[] = [];
  for (const alternative of intent.alternatives) {
    const terms: string[] = [];
    if (alternative.product_type) terms.push(...typeTerms(alternative.product_type));
    // Each manufacturer's words join with AND before brands OR together, so a
    // multi-word brand cannot broaden retrieval to either token alone and
    // exhaust the capped fact window with partial matches.
    const brandBranches = (alternative.brands ?? []).map((brand) => {
      const tokens = sanitizeTerm(brand);
      if (tokens.length === 1) return tokens[0];
      return tokens.length > 1 ? `(${tokens.join(' & ')})` : undefined;
    }).filter((branch): branch is string => branch !== undefined);
    if (brandBranches.length === 1) terms.push(brandBranches[0]);
    else if (brandBranches.length > 1) terms.push(`(${brandBranches.join(' | ')})`);
    if (alternative.model) terms.push(...sanitizeTerm(alternative.model));
    if (alternative.compatible_with) terms.push(...sanitizeTerm(alternative.compatible_with));
    for (const attribute of alternative.attributes ?? []) {
      terms.push(...(attribute.operator === 'eq'
        ? attributeTerms(attribute.key, attribute.value)
        : rangeTerms(attribute.key, attribute.value)));
    }
    const group = groupQuery(terms);
    if (group) groups.push(group);
  }
  if (groups.length > 0) return groups.join(' | ');
  const fallback = groupQuery(sanitizeTerm(fallbackQuery).filter((term) => !FALLBACK_STOPWORDS.has(term)));
  return fallback ?? '(a & !a)';
}
