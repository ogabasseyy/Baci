function isConvertibleInConnector(tokens: string[], index: number) {
  return (
    tokens[index] === 'in' &&
    /^\d+$/u.test(tokens[index - 1] ?? '') &&
    /^\d+$/u.test(tokens[index + 1] ?? '')
  );
}

function expandMixedGameCodeToken(token: string) {
  return (
    token.match(/^([a-z]{2,})(\d(?:[a-z]\d{1,4}|\d{0,3}))$/u)?.slice(1) ?? [
      token,
    ]
  );
}

function isDimensionToken(tokens: string[], index: number) {
  const token = tokens[index] ?? '';
  if (!/^\d+$/u.test(token)) {
    return false;
  }
  const previousToken = tokens[index - 1] ?? '';
  const nextToken = tokens[index + 1] ?? '';
  const hasConvertibleNeighbor =
    (previousToken === 'in' && isConvertibleInConnector(tokens, index - 1)) ||
    (nextToken === 'in' && isConvertibleInConnector(tokens, index + 1));
  if (hasConvertibleNeighbor) {
    return false;
  }
  return (
    ['in', 'inch'].includes(previousToken) || ['in', 'inch'].includes(nextToken)
  );
}

const LAPTOP_CATEGORY_SLUGS = new Set(['gaming-laptops', 'laptops']);
const NUMERIC_PROCESSOR_SUFFIX_PATTERN = /^\d{3,}(?:[uhtpkgfy]|h[rsx])$/u;
const TRAILING_HARDWARE_METADATA_PATTERN =
  /^(?:geforce|nvidia|ram|vram|\d+(?:gb|tb|mb|hz|w))$/u;

function isNumericLaptopProcessorSuffix(tokens: string[], index: number) {
  return NUMERIC_PROCESSOR_SUFFIX_PATTERN.test(tokens[index] ?? '');
}

function isHardwareOnlyTail(tokens: string[]) {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? '';
    if (token === 'rtx' && /^\d+$/u.test(tokens[index + 1] ?? '')) {
      index += 1;
      continue;
    }
    if (!TRAILING_HARDWARE_METADATA_PATTERN.test(token)) {
      return false;
    }
  }
  return true;
}

function stripTrailingLaptopProcessorTier(
  tokens: string[],
  categorySlug: string
) {
  if (!LAPTOP_CATEGORY_SLUGS.has(categorySlug)) {
    return tokens;
  }
  const processorIndex = tokens.findIndex(
    (token, index) =>
      ((token === 'ultra' || token === 'rtx') &&
        /^\d+$/u.test(tokens[index + 1] ?? '')) ||
      (token === 'core' && /^i[3579]$/u.test(tokens[index + 1] ?? '')) ||
      (token === 'core' &&
        /^\d+$/u.test(tokens[index + 1] ?? '') &&
        NUMERIC_PROCESSOR_SUFFIX_PATTERN.test(tokens[index + 2] ?? '')) ||
      (token === 'ryzen' &&
        /^\d{1,2}$/u.test(tokens[index + 1] ?? '') &&
        (NUMERIC_PROCESSOR_SUFFIX_PATTERN.test(tokens[index + 2] ?? '') ||
          tokens[index + 2] === 'rtx' ||
          index + 2 === tokens.length)) ||
      /^i[3579]$/u.test(token) ||
      isNumericLaptopProcessorSuffix(tokens, index)
  );
  if (processorIndex < 1) {
    return tokens;
  }
  const processorToken = tokens[processorIndex] ?? '';
  const hasExtendedProcessorSuffix =
    (processorToken === 'core' || processorToken === 'ryzen') &&
    NUMERIC_PROCESSOR_SUFFIX_PATTERN.test(tokens[processorIndex + 2] ?? '');
  const processorEndIndex = hasExtendedProcessorSuffix
    ? processorIndex + 3
    : ['core', 'ryzen', 'ultra', 'rtx'].includes(processorToken)
      ? processorIndex + 2
      : processorIndex + 1;
  const trailingTokens = tokens.slice(processorEndIndex);
  let processorStartIndex = processorIndex;
  if (
    tokens[processorIndex] === 'ultra' &&
    tokens[processorIndex - 1] === 'core'
  ) {
    processorStartIndex =
      tokens[processorIndex - 2] === 'intel'
        ? processorIndex - 2
        : processorIndex - 1;
  } else if (tokens[processorIndex] === 'ryzen') {
    processorStartIndex = processorIndex;
  } else if (
    tokens[processorIndex] === 'core' &&
    /^\d+$/u.test(tokens[processorIndex + 1] ?? '')
  ) {
    processorStartIndex =
      tokens[processorIndex - 1] === 'intel'
        ? processorIndex - 1
        : processorIndex;
  } else if (
    isNumericLaptopProcessorSuffix(tokens, processorIndex) &&
    /^\d{1,2}$/u.test(tokens[processorIndex - 1] ?? '')
  ) {
    processorStartIndex = processorIndex - 1;
  } else if (
    /^i[3579]$/u.test(tokens[processorIndex] ?? '') &&
    tokens[processorIndex - 1] === 'core'
  ) {
    processorStartIndex =
      tokens[processorIndex - 2] === 'intel'
        ? processorIndex - 2
        : processorIndex - 1;
  }
  if (trailingTokens.length > 0 && !isHardwareOnlyTail(trailingTokens)) {
    return [
      ...tokens.slice(0, processorStartIndex),
      ...tokens.slice(processorEndIndex),
    ];
  }
  return tokens.slice(0, processorStartIndex);
}

export const modelTokenMatchers = {
  expandMixedGameCodeToken,
  isConvertibleInConnector,
  isDimensionToken,
  stripTrailingLaptopProcessorTier,
};
