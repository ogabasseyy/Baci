import type {
  StorefrontAgentUiEvent,
  StorefrontAgentUiProduct,
} from '@/schemas/storefront-agent-ui-contract';
import {
  type CatalogBudgetLimit,
  type CatalogChatMessage,
  isProductWithinBudget,
} from './ogabassey-catalog-agent-budget';

export const UNGROUNDED_EMPTY_RESULT_CLAIM = /[₦$€£]|\b(?:naira|ngn)\b/i;

const POSITIVE_EMPTY_RESULT_CLAIM =
  /\b(?:in[\s-]+stock|available\s+now|available\s+for|we\s+(?:have|stock|carry|sell|offer)|(?:is|are)\s+available|available\s+in|comes?\s+in|you\s+can\s+(?:get|buy|order)|we\s+recommend|try\s+the|here\s+(?:is|are)|check\s+out)\b/i;

const NEGATION_OR_ABSENCE_CUE =
  /\b(?:no|not|don['’]?t|do\s+not|didn['’]?t|did\s+not|couldn['’]?t|could\s+not|can['’]?t|cannot|never|none|nothing|zero|unable|without|unavailable|out\s+of\s+stock|sold\s+out)\b/i;

const CLAUSE_SPLIT_PATTERN =
  /[.!?\n;]+|\b(?:but|however|although)\b|,\s*(?=(?:we|here|try|you|the|check)\b)/i;

const PRICE_MENTION_PATTERN =
  /(?:(₦|ngn\s*|[$€£]\s*)((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(?:\s*(million|thousand|[km])\b)?|((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(?:\s*(million|thousand|[km])\b)?\s*(?:naira|ngn|₦)|((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*(million|thousand|[km])\b|(\d{1,3}(?:,\d{3})+)(?:\.\d+)?)/giu;

// Only treat explicit currency, scaled, or budget-cued numbers from user turns
// as valid budget references so model numbers (e.g. "iPhone 16") never enter.
const USER_BUDGET_MENTION_PATTERN =
  /(?:(₦|ngn\s*|[$€£]\s*)((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(?:\s*(million|thousand|[km]))?|((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*(?:(million|thousand|[km])\b|(?=(?:\s*(?:naira|ngn|₦))))|(?:under|below|within|up\s+to|at\s+most|max(?:imum)?|budget(?:\s+(?:of|is))?)\s+((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(?:\s*(million|thousand|[km]))?)/giu;

const BARE_PRICE_CANDIDATE_PATTERN = /\b(\d{4,9})\b/gu;
const NON_PRICE_SPEC_SUFFIX_PATTERN =
  /^\s*(?:mah|hz|khz|mhz|ghz|nits|ppi|rpm|gb|tb|mb|kb|mp|mm|cm|w|p|x)\b/i;
const RESOLUTION_SPEC_SUFFIX_PATTERN =
  /^\s*(?:displays?|screens?|resolutions?|uhd|oled|amoled|qled|ips|lcd|video|tvs?|monitors?|webcams?|cameras?|streaming)\b/i;
const MODEL_NUMBER_PREFIX_PATTERN =
  /(?:rtx|gtx|rx|arc|ryzen|core|i\d-|snapdragon|dimensity|helio|exynos|tensor|model|gen)\s*$/i;
const PRICE_CUE_PREFIX_PATTERN =
  /(?:costs?|priced?\s+at|for|at|from|only|under|below|within|up\s+to|at\s+most|budget(?:\s+(?:of|is))?)\s*$/i;
const BUDGET_FRAME_PREFIX_PATTERN =
  /\b(?:under|below|within|up\s+to|at\s+most|max(?:imum)?|budget)\b[^.!?\n]{0,24}$/i;
const BUDGET_FRAME_SUFFIX_PATTERN = /^[^.!?\n]{0,16}\b(?:budget|limit|cap)\b/i;

const STOCK_COUNT_PATTERN =
  /(?:\b(\d+)\s+(?:in[\s-]+stock|left(?:\s+in\s+stock)?|remaining|available(?:\s+now)?|units?\b)|\bonly\s+(\d+)\s+(?:left|remaining|available)\b)/giu;

const OUT_OF_STOCK_ASSERTION =
  /\b(?:out\s+of\s+stock|sold\s+out|currently\s+unavailable|no\s+stock)\b/gi;
const POSITIVE_STOCK_ASSERTION =
  /\b(?:in[\s-]+stock|currently\s+available|available\s+now)\b/gi;

const FAMILY_VARIANT_PATTERN =
  /\b(?:macbook|iphone|ipad|imac|galaxy|pixel|xps|surface|watch|redmi|tecno|infinix|oneplus|playstation)\s+(?:(?:pro|ultra|max|mini|plus|air|studio|fold|flip|fe|se|lite|neo|edge|spark|camon|phantom|hot|note|nord|pixel)\b|[a-z]{0,2}\d{1,4}[a-z]?\b)(?:\s+(?:pro|ultra|max|mini|plus|air|studio|fold|flip|fe|se|lite|neo|[a-z]{0,2}\d{1,4}[a-z]?\b)){0,2}/gi;

const CAPITALIZED_PHRASE_PATTERN =
  /\b(?:iPhone|iPad|iMac|[A-Z][A-Za-z0-9-]{1,24})(?:\s+(?:iPhone|iPad|iMac|[A-Z0-9][A-Za-z0-9-]{0,24})){1,4}\b/g;

const CAPITALIZED_PHRASE_IGNORE = new Set([
  'ogabassey',
  'naira',
  'ngn',
  'usd',
  'eur',
  'gbp',
  'the',
  'we',
  'you',
  'this',
  'that',
  'these',
  'those',
  'here',
  'there',
  'try',
  'check',
  'found',
  'sorry',
  'yes',
  'no',
  'for',
  'our',
  'your',
  'it',
  'if',
  'only',
  'option',
  'options',
  'step',
  'laptop',
  'laptops',
  'phone',
  'phones',
  'smartphone',
  'smartphones',
  'tablet',
  'tablets',
  'nigeria',
  'lagos',
  'abuja',
]);

const GENERIC_PRODUCT_NAME_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'in',
  'on',
  'of',
  'or',
  'gb',
  'tb',
  'mb',
  'ram',
  'rom',
  'ssd',
  'hdd',
  'inch',
  'inches',
  'black',
  'white',
  'blue',
  'silver',
  'gold',
  'gray',
  'grey',
  'green',
  'pink',
  'red',
  'new',
  'used',
  'edition',
  'series',
  'model',
  'wifi',
  'cellular',
  '5g',
  '4g',
  'lte',
]);

const KNOWN_BRAND_OR_LINE_TOKENS = new Set([
  'apple',
  'samsung',
  'dell',
  'hp',
  'lenovo',
  'asus',
  'acer',
  'sony',
  'google',
  'microsoft',
  'huawei',
  'xiaomi',
  'redmi',
  'poco',
  'tecno',
  'infinix',
  'itel',
  'oneplus',
  'oppo',
  'vivo',
  'realme',
  'motorola',
  'nokia',
  'lg',
  'hisense',
  'toshiba',
  'msi',
  'razer',
  'alienware',
  'jbl',
  'bose',
  'beats',
  'anker',
  'canon',
  'nikon',
  'gopro',
  'nintendo',
  'playstation',
  'xbox',
  'logitech',
  'corsair',
  'oraimo',
  'ugreen',
  'baseus',
  'starlink',
  'framework',
  'macbook',
  'iphone',
  'ipad',
  'imac',
  'airpods',
  'galaxy',
  'pixel',
  'thinkpad',
  'ideapad',
  'yoga',
  'legion',
  'xps',
  'latitude',
  'inspiron',
  'vostro',
  'precision',
  'pavilion',
  'envy',
  'spectre',
  'elitebook',
  'probook',
  'zbook',
  'victus',
  'omen',
  'zenbook',
  'vivobook',
  'rog',
  'tuf',
  'aspire',
  'swift',
  'predator',
  'nitro',
  'surface',
  'ps4',
  'ps5',
  'airtag',
  'homepod',
  'xm4',
  'xm5',
]);

function tokenizeLowerWords(value: string): string[] {
  return (value.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
    (token) => token.length >= 2
  );
}

function collectReturnedProductTokens(
  events: StorefrontAgentUiEvent[]
): Set<string> {
  const tokens = new Set<string>();
  for (const event of events) {
    for (const product of event.products) {
      const fields = [
        product.name,
        product.brand,
        product.category,
        product.description,
        product.slug,
        product.variantModel,
      ];
      for (const field of fields) {
        if (!field) continue;
        for (const token of field.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
          if (token.length >= 2 || /^\d$/.test(token)) {
            tokens.add(token);
          }
        }
      }
    }
  }
  return tokens;
}

function productMatchesSegment(
  product: StorefrontAgentUiProduct,
  segment: string
): number {
  const lowerSegment = segment.toLowerCase();
  const fullName = product.name.trim().toLowerCase();
  if (fullName && lowerSegment.includes(fullName)) {
    return 100 + tokenizeLowerWords(fullName).length;
  }

  const segmentTokens = new Set(
    lowerSegment
      .match(/[a-z0-9]+/g)
      ?.filter((t) => t.length >= 2 || /^\d$/.test(t)) ?? []
  );
  const nameTokens = (
    product.name.toLowerCase().match(/[a-z0-9]+/g) ?? []
  ).filter(
    (token) =>
      (token.length >= 2 || /^\d$/.test(token)) &&
      !GENERIC_PRODUCT_NAME_WORDS.has(token)
  );
  const brandTokens = new Set(tokenizeLowerWords(product.brand ?? ''));
  const nonBrandTokens = nameTokens.filter((token) => !brandTokens.has(token));
  const pool = nonBrandTokens.length > 0 ? nonBrandTokens : nameTokens;
  if (pool.length === 0) return 0;

  const modelVersionTokens = pool.filter((token) => /\d/.test(token));
  if (
    modelVersionTokens.length > 0 &&
    !modelVersionTokens.every((token) => segmentTokens.has(token))
  ) {
    return 0;
  }

  let score = 0;
  for (const token of pool) {
    if (segmentTokens.has(token)) score += 1;
  }
  const requiredMatches =
    pool.length <= 3 ? pool.length : Math.max(2, Math.ceil(pool.length * 0.6));
  return score >= requiredMatches ? score : 0;
}

function findBoundProducts(
  text: string,
  offset: number,
  products: StorefrontAgentUiProduct[]
): StorefrontAgentUiProduct[] {
  const splitBoundaries = (regex: RegExp) => {
    let start = 0;
    let end = text.length;
    for (const match of text.matchAll(regex)) {
      const idx = match.index ?? 0;
      const matchEnd = idx + match[0].length;
      if (matchEnd <= offset) start = Math.max(start, matchEnd);
      else if (idx >= offset && end === text.length) {
        end = idx;
        break;
      }
    }
    return text.slice(start, end);
  };

  const localClause = splitBoundaries(
    /[.!?\n;—–]+|\b(?:and|while|versus|vs)\b/gi
  );
  const sentence = splitBoundaries(/[.!?\n;]+/g);

  for (const candidate of [localClause, sentence, text]) {
    let bestScore = 0;
    let best: StorefrontAgentUiProduct[] = [];
    for (const product of products) {
      const score = productMatchesSegment(product, candidate);
      if (score > bestScore) {
        bestScore = score;
        best = [product];
      } else if (score > 0 && score === bestScore) {
        best.push(product);
      }
    }
    if (bestScore > 0) return best;
  }

  return products;
}

function hasGroundedProductMentions(
  text: string,
  events: StorefrontAgentUiEvent[]
): boolean {
  const products = events.flatMap((event) => event.products);
  if (products.length === 0) return false;

  const matchesReturnedProduct = products.some(
    (product) => productMatchesSegment(product, text) > 0
  );
  if (!matchesReturnedProduct) return false;

  const returnedTokens = collectReturnedProductTokens(events);
  const clauses = text
    .split(CLAUSE_SPLIT_PATTERN)
    .map((clause) => clause.trim())
    .filter(Boolean);

  for (const clause of clauses) {
    if (NEGATION_OR_ABSENCE_CUE.test(clause)) continue;

    for (const token of tokenizeLowerWords(clause)) {
      if (KNOWN_BRAND_OR_LINE_TOKENS.has(token) && !returnedTokens.has(token)) {
        return false;
      }
    }

    for (const match of clause.matchAll(FAMILY_VARIANT_PATTERN)) {
      const phraseTokens = tokenizeLowerWords(match[0]);
      if (phraseTokens.some((token) => !returnedTokens.has(token))) {
        return false;
      }
    }

    for (const match of clause.matchAll(CAPITALIZED_PHRASE_PATTERN)) {
      const words = (match[0].toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
        (token) => !CAPITALIZED_PHRASE_IGNORE.has(token)
      );
      if (
        words.length >= 2 &&
        words.some((token) => !returnedTokens.has(token))
      ) {
        return false;
      }
    }
  }

  return true;
}

export function hasGroundedEmptyCatalogText(
  text: string,
  userMessages: CatalogChatMessage[] = []
): boolean {
  const userAmounts = extractUserPriceMentions(userMessages);
  const validatedSpans: Array<{ start: number; end: number }> = [];

  for (const match of text.matchAll(PRICE_MENTION_PATTERN)) {
    const rawNumber = match[2] ?? match[4] ?? match[6] ?? match[8];
    const unit = match[3] ?? match[5] ?? match[7];
    if (!rawNumber) continue;
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (
      match[6] !== undefined &&
      unit?.toLowerCase() === 'k' &&
      RESOLUTION_SPEC_SUFFIX_PATTERN.test(text.slice(end, end + 24))
    ) {
      continue;
    }
    const amount = applyNumericScale(rawNumber, unit);
    if (!Number.isFinite(amount) || amount <= 0) return false;
    if (!isBudgetRestatement(text, start, end) || !userAmounts.has(amount)) {
      return false;
    }
    validatedSpans.push({ start, end });
  }

  for (const match of text.matchAll(BARE_PRICE_CANDIDATE_PATTERN)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (validatedSpans.some((span) => start >= span.start && end <= span.end)) {
      continue;
    }
    const amount = Number(match[1]);
    if (isBareNonPriceSpec(text, start, end, amount)) continue;
    if (!isBudgetRestatement(text, start, end) || !userAmounts.has(amount)) {
      return false;
    }
    validatedSpans.push({ start, end });
  }

  let withoutBudgetRestatements = text;
  for (let i = validatedSpans.length - 1; i >= 0; i -= 1) {
    const { start, end } = validatedSpans[i];
    withoutBudgetRestatements =
      withoutBudgetRestatements.slice(0, start) +
      ' ' +
      withoutBudgetRestatements.slice(end);
  }

  if (UNGROUNDED_EMPTY_RESULT_CLAIM.test(withoutBudgetRestatements)) {
    return false;
  }
  if (!NEGATION_OR_ABSENCE_CUE.test(text)) return false;

  const clauses = text
    .split(CLAUSE_SPLIT_PATTERN)
    .map((clause) => clause.trim())
    .filter(Boolean);

  for (const clause of clauses) {
    if (NEGATION_OR_ABSENCE_CUE.test(clause)) continue;
    if (POSITIVE_EMPTY_RESULT_CLAIM.test(clause)) return false;
    if (
      tokenizeLowerWords(clause).some((token) =>
        KNOWN_BRAND_OR_LINE_TOKENS.has(token)
      )
    ) {
      return false;
    }
  }

  return true;
}

function applyNumericScale(rawValue: string, unit?: string): number {
  const numeric = Number(rawValue.replaceAll(',', ''));
  if (!Number.isFinite(numeric)) return Number.NaN;
  if (/^(?:m|million)$/i.test(unit ?? '')) {
    return Math.round(numeric * 1_000_000);
  }
  if (/^(?:k|thousand)$/i.test(unit ?? '')) {
    return Math.round(numeric * 1_000);
  }
  return Math.round(numeric);
}

function extractUserPriceMentions(messages: CatalogChatMessage[]): Set<number> {
  const values = new Set<number>();
  for (const message of messages) {
    if (message.role !== 'user') continue;
    for (const match of message.content.matchAll(USER_BUDGET_MENTION_PATTERN)) {
      const rawNumber = match[2] ?? match[4] ?? match[6];
      const unit = match[3] ?? match[5] ?? match[7];
      if (!rawNumber) continue;
      const parsed = applyNumericScale(rawNumber, unit);
      if (Number.isFinite(parsed) && parsed > 0) {
        values.add(parsed);
      }
    }
  }
  return values;
}

function isBudgetRestatement(
  text: string,
  start: number,
  end: number
): boolean {
  const before = text.slice(Math.max(0, start - 32), start);
  const after = text.slice(end, Math.min(text.length, end + 24));
  return (
    BUDGET_FRAME_PREFIX_PATTERN.test(before) ||
    BUDGET_FRAME_SUFFIX_PATTERN.test(after)
  );
}

function isBareNonPriceSpec(
  text: string,
  start: number,
  end: number,
  amount: number
): boolean {
  const before = text.slice(Math.max(0, start - 24), start);
  const after = text.slice(end, Math.min(text.length, end + 16));
  if (NON_PRICE_SPEC_SUFFIX_PATTERN.test(after)) return true;
  if (MODEL_NUMBER_PREFIX_PATTERN.test(before)) return true;
  if (
    amount >= 2010 &&
    amount <= 2035 &&
    !PRICE_CUE_PREFIX_PATTERN.test(before)
  ) {
    return true;
  }
  return false;
}

function hasGroundedPriceClaims(
  text: string,
  products: StorefrontAgentUiProduct[],
  userAmounts: Set<number>
): boolean {
  const checkedSpans: Array<{ start: number; end: number }> = [];

  for (const match of text.matchAll(PRICE_MENTION_PATTERN)) {
    const rawNumber = match[2] ?? match[4] ?? match[6] ?? match[8];
    const unit = match[3] ?? match[5] ?? match[7];
    if (!rawNumber) continue;

    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (
      match[6] !== undefined &&
      unit?.toLowerCase() === 'k' &&
      RESOLUTION_SPEC_SUFFIX_PATTERN.test(text.slice(end, end + 24))
    ) {
      continue;
    }

    const amount = applyNumericScale(rawNumber, unit);
    if (!Number.isFinite(amount) || amount <= 0) return false;
    checkedSpans.push({ start, end });

    if (isBudgetRestatement(text, start, end) && userAmounts.has(amount)) {
      continue;
    }
    const bound = findBoundProducts(text, start, products);
    if (!bound.some((product) => Math.round(product.price) === amount)) {
      return false;
    }
  }

  for (const match of text.matchAll(BARE_PRICE_CANDIDATE_PATTERN)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (checkedSpans.some((span) => start >= span.start && end <= span.end)) {
      continue;
    }
    const amount = Number(match[1]);
    if (isBareNonPriceSpec(text, start, end, amount)) continue;
    if (isBudgetRestatement(text, start, end) && userAmounts.has(amount)) {
      continue;
    }
    const bound = findBoundProducts(text, start, products);
    if (!bound.some((product) => Math.round(product.price) === amount)) {
      return false;
    }
  }

  return true;
}

function hasGroundedStockClaims(
  text: string,
  products: StorefrontAgentUiProduct[]
): boolean {
  for (const match of text.matchAll(STOCK_COUNT_PATTERN)) {
    const rawCount = match[1] ?? match[2];
    if (!rawCount) continue;
    const claimedStock = Number(rawCount);
    const offset = match.index ?? 0;
    const bound = findBoundProducts(text, offset, products);
    if (!bound.some((product) => product.stock === claimedStock)) {
      return false;
    }
  }

  for (const match of text.matchAll(OUT_OF_STOCK_ASSERTION)) {
    const offset = match.index ?? 0;
    const before = text.slice(Math.max(0, offset - 20), offset);
    if (/\b(?:not|never)\s+$/i.test(before)) continue;
    const bound = findBoundProducts(text, offset, products);
    if (
      bound.every(
        (product) =>
          !product.manageStock ||
          (typeof product.stock === 'number' && product.stock > 0)
      )
    ) {
      return false;
    }
  }

  for (const match of text.matchAll(POSITIVE_STOCK_ASSERTION)) {
    const offset = match.index ?? 0;
    const before = text.slice(Math.max(0, offset - 20), offset);
    if (NEGATION_OR_ABSENCE_CUE.test(before)) continue;
    const bound = findBoundProducts(text, offset, products);
    if (
      bound.every(
        (product) =>
          product.manageStock &&
          (typeof product.stock !== 'number' || product.stock <= 0)
      )
    ) {
      return false;
    }
  }

  return true;
}

export function hasGroundedCatalogResultText(
  text: string,
  events: StorefrontAgentUiEvent[],
  userMessages: CatalogChatMessage[],
  currencyCode: string,
  budgetLimit?: CatalogBudgetLimit
): boolean {
  const products = events.flatMap((event) => event.products);
  if (
    !products.every((product) =>
      isProductWithinBudget(product.price, budgetLimit)
    )
  ) {
    return false;
  }

  if (!hasGroundedProductMentions(text, events)) return false;

  if (
    currencyCode.toUpperCase() === 'NGN' &&
    /[$€£]/.test(text) &&
    !userMessages.some(
      (message) => message.role === 'user' && /[$€£]/.test(message.content)
    )
  ) {
    return false;
  }

  const userAmounts = extractUserPriceMentions(userMessages);
  if (!hasGroundedPriceClaims(text, products, userAmounts)) return false;
  if (!hasGroundedStockClaims(text, products)) return false;

  return true;
}
