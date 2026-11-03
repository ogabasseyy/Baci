import {
  ACCESSORY_SIGNAL,
  normalizeAccessoryNouns,
  normalizeCatalogModelPunctuation,
} from './fast-catalog-language';

// Unbound word-form models are only returned when extra name words are benign.
const WORD_PLUS_DESCRIPTORS = new Set(
  'galaxy true wireless bluetooth stereo tws earbud earphone headphone headset black white blue pink red purple gray grey silver gold green graphite cream beige'.split(
    ' '
  )
);

/** Preserve Plus candidates in both word-form and punctuation-normalized rankings. */
export function catalogSearchQueries(query: string): string[] {
  const text = normalizeCatalogModelPunctuation(query)
    .trim()
    .replace(/\s+/g, ' ');
  if (!text) return [];
  const specific = text
    .replace(
      /\b([a-z0-9]{0,11}\d[a-z0-9]{0,4}(?:[ -]{1,16}(?:pro|max|ultra)){0,2})(?:\+|[ -]{1,16}plus\b)/gi,
      '$1 Plus '
    )
    .replace(/\s+/g, ' ')
    .trim();
  const broad = text
    .replace(
      /\b([a-z0-9]{0,11}\d[a-z0-9]{0,4}(?:[ -]{1,16}(?:pro|max|ultra)){0,2})(?:\+|[ -]{1,16}plus\b)/gi,
      '$1 '
    )
    .replace(/\s+/g, ' ')
    .trim();
  return [...new Set([specific, broad])];
}

/** Only bounded alphanumeric terms enter the literal Plus-name lookup. */
export function catalogSymbolModelLookup(
  query: string
): { symbol: string; anchor?: string } | null {
  const match = normalizeCatalogModelPunctuation(query).match(
    /\b([a-z0-9]{0,11}\d[a-z0-9]{0,4})((?:[ -]{1,16}(?:pro|max|ultra)){0,2})(?:\+|[ -]{1,16}plus\b)/i
  );
  if (!match?.[1] || match[1].length > 12) return null;
  const suffix = match[2].split(/[ -]+/).filter(Boolean).at(-1);
  return suffix ? { symbol: suffix, anchor: match[1] } : { symbol: match[1] };
}

export function catalogMatchesModel(
  query: string,
  name: string,
  brand: string | null
): boolean {
  const words = (value: string) =>
    normalizeAccessoryNouns(normalizeCatalogModelPunctuation(value))
      .toLowerCase()
      .replace(
        /(?<![\p{L}\p{N}])([\p{L}\p{N}]{0,11}\d[\p{L}\p{N}]{0,11})\+/gu,
        '$1 plus '
      )
      .replace(/\b(pro|max|ultra)\+/gi, '$1 plus ')
      .replace(/([\p{L}\p{N}])\+(?=$|[^\p{L}\p{N}])/gu, '$1 plus')
      .match(/[\p{L}\p{N}]+/gu) ?? [];
  const plusModels = (value: string) => {
    const normalized = normalizeCatalogModelPunctuation(value)
      .toLowerCase()
      .replace(/\s+/g, ' ');
    let ambiguous = false;
    const models = [
      ...normalized.matchAll(
        /(?<![\p{L}\p{N}])([\p{L}\p{N}]+)(?:\+|[ -]+plus\b| +\+)/gu
      ),
    ].flatMap((match) => {
      let model = match[1];
      if (!/\d/u.test(model)) {
        if (!/^(?:pro|max|ultra)$/i.test(model)) return [];
        const prefix = normalized.slice(
          Math.max(0, match.index - 80),
          match.index
        );
        const anchor = prefix.match(
          /(?:^|[^\p{L}\p{N}])([a-z0-9]{0,11}\d[a-z0-9]{0,4})((?:[ -]{1,16}(?:pro|max|ultra)){0,1})[ -]{1,16}$/iu
        );
        if (!anchor || anchor[1].length > 12) return [];
        model = [
          anchor[1],
          ...anchor[2].split(/[ -]+/).filter(Boolean),
          model,
        ].join(' ');
      }
      if (match[1].length > 12 || / +\+$/.test(match[0])) {
        ambiguous = true;
        return [];
      }
      const suffix = normalized.slice(
        match.index + match[0].length,
        match.index + match[0].length + 121
      );
      if (match[0].endsWith('+')) {
        if (/^(?![345]g\b)[\p{L}\p{N}]/u.test(suffix)) {
          ambiguous = true;
          return [];
        }
      } else {
        const clause = suffix.split(/\b(?:with|and|including)\b|[,;]/i, 1)[0];
        if (clause.length > 120 || ACCESSORY_SIGNAL.test(clause)) {
          ambiguous = true;
          return [];
        }
      }
      return [model];
    });
    return { models, ambiguous };
  };
  const requestedPlus = plusModels(query);
  const normalizedQuery = normalizeCatalogModelPunctuation(query).toLowerCase();
  const unboundWordPlus = [
    ...normalizedQuery.matchAll(
      /(?<![\p{L}\p{N}])([\p{L}\p{N}]{1,12})[ -]{1,16}plus\b/gu
    ),
  ]
    .map((match) => match[1])
    .filter((word) => !/\d/u.test(word) && !/^(?:pro|max|ultra)$/i.test(word));
  const plusCueCount = (
    normalizedQuery.match(/[\p{L}\p{N}]+|\+/gu) ?? []
  ).filter((token) => token === '+' || token === 'plus').length;
  // Secondary clauses can describe a different model, a bundle or an exclusion.
  const normalizedName = normalizeCatalogModelPunctuation(name)
    .replace(/\s+/g, ' ')
    .replace(/\(\s*([345]g)\s*\)/gi, ' $1 ');
  const primaryName = plusCueCount
    ? normalizedName.split(
        /\b(?:with|and|or|but|including|except|excluding|without|not|no|non|incompatible)\b|[(),;&]|\s+-\s+/iu,
        1
      )[0]
    : normalizedName;
  const required = words(query);
  const actualWords = words(primaryName);
  const brandWords = new Set(words(brand ?? ''));
  const actual = new Set([...actualWords, ...brandWords]);
  const wordPlusPairs = new Set(
    actualWords.filter((_, index) => actualWords[index + 1] === 'plus')
  );
  const requestedWords = new Set(required);
  const plusWords = new Set(unboundWordPlus);
  const firstWordPlus = actualWords.findIndex(
    (word, index) => plusWords.has(word) && actualWords[index + 1] === 'plus'
  );
  const unrequestedWords =
    unboundWordPlus.length > 0 &&
    actualWords.some(
      (word, index) =>
        !requestedWords.has(word) &&
        !WORD_PLUS_DESCRIPTORS.has(word) &&
        !(index < firstWordPlus && brandWords.has(word))
    );
  const actualPlus = new Set(plusModels(primaryName).models);
  return (
    !requestedPlus.ambiguous &&
    !unrequestedWords &&
    plusCueCount <= requestedPlus.models.length + unboundWordPlus.length &&
    unboundWordPlus.every((word) => wordPlusPairs.has(word)) &&
    required.length > 0 &&
    required.every((word) => actual.has(word)) &&
    requestedPlus.models.every((model) => actualPlus.has(model))
  );
}
