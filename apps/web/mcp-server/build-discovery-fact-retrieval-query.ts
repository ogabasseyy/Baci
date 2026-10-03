import { createHash } from 'node:crypto';
import { toAsciiLowerCase } from '@baci/shared/lib';
import { canonicalizeDiscoveryProductType } from '../src/schemas/canonical-discovery-product-type';
import type { McpDiscoveryIntent } from '../src/schemas/mcp-discovery-intent';
import { structuredDiscoveryIdentity } from './structured-discovery-identity';

const NUMERIC_UNITS: Record<string, string> = {
  storage_gb: 'GB', ram_gb: 'GB', power_w: 'W', screen_inches: 'inch', refresh_hz: 'Hz',
};
// Term budgets apply per value, never per group: every structured constraint
// always participates in retrieval (long free-text values keep leading
// terms), so no constraint is silently dropped and value/key pairs stay
// atomic. Truncation drops whole trailing terms, never splits syntax, and the
// matcher still enforces every constraint.
// Model and compatible_with identifiers keep every token: the schema already
// bounds values to 100 chars and the database gates the whole query at 16000
// chars, while the matcher only sees recalled candidates, so a truncated
// distinguishing token would silently lose valid products.
const MAX_FALLBACK_TERMS = 12;
// Plain-language connectives are required lexemes under to_tsquery (only '|'
// is OR), so the fallback path drops them instead of collapsing recall.
const FALLBACK_STOPWORDS = new Set(['or', 'and', 'a', 'the']);
// Identity constraints retrieve through key-specific lexemes derived from the
// same authoritative fields the matcher verifies, so marketing prose can no
// longer fill the capped fact window ahead of identity matches. Brand, model,
// and compatibility keys are exact digests of the final matcher
// normalization; only canonical type keys stay coarse.

function sanitizeTerm(value: string): string[] {
  // Dots survive inside version-like lexemes ('1.5' parses), but a dot-only
  // term voids the whole group server-side, so strip edge dots and drop terms
  // with no letters or numbers. NFC first: without it a decomposed model like
  // NFD 'Café Pro' sheds its combining mark and can never match the composed
  // lexeme stored in metadata-only documents.
  return value.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}.\s]+/gu, ' ').split(/\s+/)
    .map((term) => term.replace(/^\.+|\.+$/g, ''))
    .filter((term) => /[\p{L}\p{N}]/u.test(term));
}

// trim_scale parity: JavaScript renders very small or large numbers with an
// exponent ('1e-7'), but the SQL index expands JSON numbers to plain
// decimals, and the exponent sign is invalid to_tsquery syntax that would
// poison the whole group. Non-exponent spellings pass through untouched.
function decimalTerm(value: number): string {
  const text = String(value);
  const match = /^(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(text);
  if (!match) return text;
  const [, head, tail = '', expText] = match;
  const point = head.length + Number(expText);
  const digits = (head + tail).replace(/^0+(?=\d)/, '');
  if (point <= 0) return `0.${'0'.repeat(-point)}${digits}`.replace(/0+$/, '').replace(/\.$/, '');
  if (point >= digits.length) return digits + '0'.repeat(point - digits.length);
  const out = `${digits.slice(0, point)}.${digits.slice(point)}`.replace(/0+$/, '');
  return out.endsWith('.') ? out.slice(0, -1) : out;
}

function attributeTerms(key: string, value: string | number): string[] {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return [];
    const unit = NUMERIC_UNITS[key];
    const identity = key.replace(/_gb$/, '').replace(/_w$/, '').replace(/_inches$/, '')
      .replace(/_hz$/, '');
    return [`${identity}${decimalTerm(value)}${unit ?? ''}`.toLowerCase()];
  }
  // Hash a correlated key/value pair. Separate key and value postings can be
  // satisfied by different metadata fields or by unstructured marketing text.
  const normalizedKey = structuredDiscoveryIdentity.normalizeText(key);
  const normalizedValue = structuredDiscoveryIdentity.normalizeText(value);
  if (!normalizedKey || !normalizedValue) return [];
  const pairDigest = createHash('sha256').update(`${normalizedKey}\u001f${normalizedValue}`, 'utf8').digest('hex');
  return [`fact${pairDigest}`];
}

// Ranges cannot be tsquery terms, but the combined document carries keyed
// presence lexemes (ramgb, storagegb, etc.) so retrieval preserves the
// attribute identity while the matcher enforces the bound.
function rangeTerms(key: string, value: string | number): string[] {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return [];
  const unit = NUMERIC_UNITS[key];
  const identity = key.replace(/_gb$/, '').replace(/_w$/, '').replace(/_inches$/, '')
    .replace(/_hz$/, '');
  return unit ? [`${identity}${unit}`.toLowerCase()] : [];
}

function groupQuery(terms: string[]): string | undefined {
  if (terms.length === 0) return undefined;
  return `(${terms.join(' & ')})`;
}

// Lexemes longer than this digest on both sides (SQL mirrors in
// discovery_identity_lexeme): NFKC can triple ASCII length, and five
// alternatives of max-length identities would otherwise push the joined
// query past the 16k tsquery gate. Digests keep every constraint exact.
const MAX_IDENTITY_LEXEME_CHARS = 64;

function identityKey(prefix: string, value: string): string | undefined {
  // Brand, model, and compatibility keys are exact digests of the FINAL
  // matcher normalization (shared, not reimplemented): coarse NFKC keys
  // folded separators the matcher distinguishes ('A B' vs 'A-B'), so
  // collisions filled the capped fact window ahead of the true match with
  // no recovery source for identity-only searches. The digest input keeps
  // the tag + unit-separator shape so tags stay distinct.
  if (prefix === 'brand' || prefix === 'model' || prefix === 'compat') {
    const matcher = structuredDiscoveryIdentity.normalizeText(value);
    if (!matcher) return undefined;
    return `fact${createHash('sha256').update(`${prefix}\u001f${matcher}`, 'utf8').digest('hex')}`;
  }
  // Type keys stay coarse: both sides canonicalize through the shared
  // canonicalizer, so the key already equals the matcher comparison.
  // ASCII allowlist: PostgreSQL has no Unicode property escapes inside
  // bracket expressions, so both sides strip identically to stay in
  // agreement. Fully stripped values fall back to a correlated digest both
  // sides derive identically (tag + unit separator + normalized identity):
  // skipping the term would strand exact matches past the browse window.
  // Overlong lexemes digest identically: the stripped key is ASCII-only,
  // so code-point length equals SQL char_length exactly.
  const normalized = toAsciiLowerCase(value.normalize('NFKC').trim())
    .replace(/[\s-]+/g, '_');
  const key = normalized.replace(/[^a-z0-9_]/g, '');
  if (key && Array.from(key).length <= MAX_IDENTITY_LEXEME_CHARS) return `${prefix}${key}`;
  if (!normalized) return undefined;
  return `fact${createHash('sha256').update(`${prefix}\u001f${normalized}`, 'utf8').digest('hex')}`;
}

function typeTerms(productType: string): string[] {
  const normalized = canonicalizeDiscoveryProductType(productType);
  if (!normalized) return [];
  const cleaned = normalized.replace(/[^a-z0-9_]/g, '');
  if (cleaned !== normalized || Array.from(cleaned).length > MAX_IDENTITY_LEXEME_CHARS) {
    return [`fact${createHash('sha256').update(`type\u001f${normalized}`, 'utf8').digest('hex')}`];
  }
  return [`type${cleaned}`];
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
    // Each manufacturer keys as one lexeme before brands OR together, so a
    // multi-word brand cannot broaden retrieval to either token alone and
    // exhaust the capped fact window with partial matches.
    const brandBranches = (alternative.brands ?? []).map((brand) => identityKey('brand', brand))
      .filter((branch): branch is string => branch !== undefined);
    if (brandBranches.length === 1) terms.push(brandBranches[0]);
    else if (brandBranches.length > 1) terms.push(`(${brandBranches.join(' | ')})`);
    if (alternative.model) {
      const models = new Set([alternative.model]);
      for (const brand of alternative.brands ?? []) {
        const bare = structuredDiscoveryIdentity.modelWithoutBrand(
          alternative.model,
          brand
        );
        if (bare) {
          models.add(bare);
          models.add(`${brand} ${bare}`);
        }
      }
      const keys = [
        ...new Set(
          [...models]
            .map((model) => identityKey('model', model))
            .filter((key): key is string => key !== undefined)
        ),
      ];
      if (keys.length === 1) terms.push(keys[0]);
      else if (keys.length > 1) terms.push(`(${keys.join(' | ')})`);
    }
    if (alternative.compatible_with) {
      const key = identityKey('compat', alternative.compatible_with);
      if (key) terms.push(key);
    }
    for (const attribute of alternative.attributes ?? []) {
      terms.push(...(attribute.operator === 'eq'
        ? attributeTerms(attribute.key, attribute.value)
        : rangeTerms(attribute.key, attribute.value)));
    }
    const group = groupQuery(terms);
    if (group) groups.push(group);
  }
  if (groups.length > 0) return groups.join(' | ');
  const fallback = groupQuery(sanitizeTerm(fallbackQuery).filter((term) => !FALLBACK_STOPWORDS.has(term)).slice(0, MAX_FALLBACK_TERMS));
  return fallback ?? '(a & !a)';
}
