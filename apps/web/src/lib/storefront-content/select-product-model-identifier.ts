import { modelTokenMatchers } from './model-token-matchers';

const { isConvertibleInConnector } = modelTokenMatchers;

const GENERIC_MODEL_MARKER_TOKENS = new Set([
  'edition',
  'model',
  'new',
  'series',
  'version',
]);
const YEAR_TOKEN_PATTERN = /^(?:19|20)\d{2}$/u;
const COMPACT_GAME_CODE_PATTERN = /^([a-z]{2,})(\d{1,4})$/u;

function expandCompactGameCodeTokens(
  tokens: string[],
  preserveGameTitleTokens: boolean
) {
  return preserveGameTitleTokens
    ? tokens.flatMap(
        (token) =>
          token.match(COMPACT_GAME_CODE_PATTERN)?.slice(1) ??
          modelTokenMatchers.expandMixedGameCodeToken(token)
      )
    : tokens;
}

function isMeaningfulModelToken(
  token: string,
  preserveGameTitleTokens = false
) {
  return (
    !/^\d+$/u.test(token) &&
    (token.length > 1 || (preserveGameTitleTokens && /^[a-z]$/u.test(token))) &&
    (!GENERIC_MODEL_MARKER_TOKENS.has(token) ||
      (preserveGameTitleTokens && token === 'new'))
  );
}

function isUsbConnectorToken(tokens: string[], index: number) {
  return (
    tokens[index - 1] === 'usb' && ['a', 'c'].includes(tokens[index] ?? '')
  );
}

function isSeriesPhraseToken(tokens: string[], index: number) {
  const token = tokens[index] ?? '';
  const nextToken = tokens[index + 1] ?? '';
  const isSeriesMarker =
    token === 'series' &&
    (/^[a-z]$/u.test(nextToken) ||
      /^\d+$/u.test(nextToken) ||
      nextToken === 'se');
  const followsSeriesMarker =
    index > 0 &&
    tokens[index - 1] === 'series' &&
    (/^[a-z]$/u.test(token) || /^\d+$/u.test(token) || token === 'se');
  return isSeriesMarker || followsSeriesMarker;
}

function normalizeAppleWatchSeTokens(tokens: string[]) {
  const normalizedTokens: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (
      tokens[index] === 'watch' &&
      tokens[index + 1] === 'series' &&
      tokens[index + 2] === 'se'
    ) {
      normalizedTokens.push('watch', 'se');
      index += 2;
      continue;
    }
    normalizedTokens.push(tokens[index] ?? '');
  }
  return normalizedTokens;
}

function isGenerationYearToken(tokens: string[], index: number) {
  const token = tokens[index] ?? '';
  if (!YEAR_TOKEN_PATTERN.test(token)) {
    return false;
  }

  const previousToken = tokens[index - 1] ?? '';
  const hasAlphanumericModelBefore = tokens
    .slice(0, index)
    .some(
      (candidate) =>
        /[a-z]/u.test(candidate) &&
        /\d/u.test(candidate) &&
        !YEAR_TOKEN_PATTERN.test(candidate)
    );
  const hasHardwareTierBefore = tokens
    .slice(0, index)
    .some(
      (candidate) =>
        /^m\d+$/u.test(candidate) ||
        /^\d{3,}[uhtpkgfy]$/u.test(candidate) ||
        /^core(?:i|ultra)\d+$/u.test(candidate)
    );
  return (
    (['gen', 'generation'].includes(previousToken) &&
      tokens
        .slice(index + 1)
        .some(
          (suffixToken) => /[a-z]/u.test(suffixToken) && /\d/u.test(suffixToken)
        )) ||
    (hasAlphanumericModelBefore &&
      !hasHardwareTierBefore &&
      !['gen', 'generation'].includes(previousToken) &&
      index === tokens.length - 1)
  );
}

function getPreferredNumericModelIndex(
  tokens: string[],
  preserveGameTitleTokens: boolean,
  hasNonYearAlphanumericModel: boolean
) {
  const numericIndices = tokens
    .map((token, index) => ({ token, index }))
    .filter(
      ({ token, index }) =>
        /^\d+$/u.test(token) &&
        (preserveGameTitleTokens ||
          !YEAR_TOKEN_PATTERN.test(token) ||
          isGenerationYearToken(tokens, index) ||
          (!['gen', 'generation'].includes(tokens[index - 1] ?? '') &&
            !hasNonYearAlphanumericModel))
    )
    .map(({ index }) => index);
  const latestNumericIndex = numericIndices.at(-1) ?? -1;
  const latestToken = tokens[latestNumericIndex] ?? '';

  if (
    latestNumericIndex < 0 ||
    !/^\d{1,2}$/u.test(latestToken) ||
    ['gen', 'generation'].includes(tokens[latestNumericIndex - 1] ?? '')
  ) {
    return latestNumericIndex;
  }

  return (
    numericIndices.findLast((index) => {
      const token = tokens[index] ?? '';
      return /^\d{3,}$/u.test(token) && !YEAR_TOKEN_PATTERN.test(token);
    }) ?? latestNumericIndex
  );
}

function isSignificantInterveningNumericToken(
  tokens: string[],
  index: number,
  numericIndex: number
) {
  const token = tokens[index] ?? '';
  const hasAlphanumericModelBefore = tokens
    .slice(0, index)
    .some(
      (prefixToken) => /[a-z]/u.test(prefixToken) && /\d/u.test(prefixToken)
    );
  const followsExplicitGenerationMarker = tokens
    .slice(index + 1, numericIndex)
    .some(
      (suffixToken, suffixIndex) =>
        ['gen', 'generation'].includes(suffixToken) &&
        /^\d+$/u.test(tokens[index + 2 + suffixIndex] ?? '')
    );
  const hasOnlyNumericSuffix = tokens
    .slice(index + 1, numericIndex + 1)
    .every((suffixToken) => /^\d+$/u.test(suffixToken));
  return (
    index < numericIndex &&
    ((hasAlphanumericModelBefore &&
      /^\d{1,2}$/u.test(token) &&
      hasOnlyNumericSuffix) ||
      (followsExplicitGenerationMarker && /^\d+$/u.test(token)))
  );
}

function reorderGenerationModelTokens(tokens: string[]) {
  const generationIndex = tokens.findIndex(
    (token, index) =>
      ['gen', 'generation'].includes(token) &&
      /^\d+$/u.test(tokens[index + 1] ?? '') &&
      /^x\d+$/u.test(tokens[index + 2] ?? '')
  );
  if (generationIndex < 0) {
    return tokens;
  }

  const modelToken = tokens[generationIndex + 2] ?? '';
  const generation = tokens[generationIndex] ?? '';
  const generationNumber = tokens[generationIndex + 1] ?? '';
  return [
    ...tokens.slice(0, generationIndex),
    modelToken,
    generation,
    generationNumber,
    ...tokens.slice(generationIndex + 3),
  ];
}

/** Selects a compact phrase from already-normalized model tokens. */
export function selectProductModelIdentifier(
  inputTokens: string[],
  preserveGameTitleTokens = false
) {
  const tokens = reorderGenerationModelTokens(
    normalizeAppleWatchSeTokens(
      expandCompactGameCodeTokens(inputTokens, preserveGameTitleTokens)
    )
  );
  const hasNonYearAlphanumericModel = tokens.some(
    (token) =>
      !YEAR_TOKEN_PATTERN.test(token) &&
      /[a-z]/u.test(token) &&
      /\d/u.test(token)
  );
  const numericIndex = getPreferredNumericModelIndex(
    tokens,
    preserveGameTitleTokens,
    hasNonYearAlphanumericModel
  );
  if (numericIndex >= 0) {
    const hasConvertibleModel = tokens.some((_, index) =>
      isConvertibleInConnector(tokens, index)
    );
    const phraseTokens = tokens.filter(
      (token, index) =>
        ((hasConvertibleModel || preserveGameTitleTokens) &&
          /^\d+$/u.test(token)) ||
        isSignificantInterveningNumericToken(tokens, index, numericIndex) ||
        index === numericIndex ||
        isMeaningfulModelToken(token, preserveGameTitleTokens) ||
        isUsbConnectorToken(tokens, index) ||
        isSeriesPhraseToken(tokens, index)
    );
    return phraseTokens.join(' ');
  }

  const alphanumericToken = tokens.find(
    (token) => /[a-z]/u.test(token) && /\d/u.test(token)
  );
  if (alphanumericToken) {
    const alphanumericIndex = tokens.indexOf(alphanumericToken);
    const prefixTokens = tokens
      .slice(0, alphanumericIndex)
      .filter(
        (token) =>
          isMeaningfulModelToken(token, preserveGameTitleTokens) ||
          isUsbConnectorToken(tokens, tokens.indexOf(token))
      );
    const suffixTokens = tokens
      .slice(alphanumericIndex + 1)
      .filter(
        (token) =>
          isMeaningfulModelToken(token, preserveGameTitleTokens) ||
          isUsbConnectorToken(tokens, tokens.indexOf(token))
      );
    const phraseTokens = [...prefixTokens, alphanumericToken, ...suffixTokens];
    return phraseTokens.join(' ');
  }

  const phraseTokens = tokens.filter((token, index) => {
    return (
      isMeaningfulModelToken(token, preserveGameTitleTokens) ||
      isUsbConnectorToken(tokens, index) ||
      isSeriesPhraseToken(tokens, index)
    );
  });
  return phraseTokens.join(' ') || tokens[0] || null;
}
