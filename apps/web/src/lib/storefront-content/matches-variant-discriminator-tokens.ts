import { isProductVariantColorToken } from './is-product-variant-color-token';
import { isProductVariantRegionToken } from './is-product-variant-region-token';
import { normalizeVariantDiscriminatorTokens } from './normalize-variant-discriminator-tokens';

const CONNECTIVITY_TOKENS = new Set([
  '4g',
  '5g',
  'anc',
  'bluetooth',
  'cellular',
  'gps',
  'lte',
  'wifi',
]);
const SIM_MODE_TOKENS = new Set([
  'dual',
  'esim',
  'nano',
  'physical',
  'sim',
  'single',
]);
const STORAGE_TOKEN_PATTERN = /^\d+(?:gb|tb|mb)$/u;
const DIMENSION_TOKEN_PATTERN = /^\d+(?:\.\d+)?(?:mm|inch)$/u;
const BATTERY_CAPACITY_TOKEN_PATTERN = /^\d+mah$/u;
const WATTAGE_TOKEN_PATTERN = /^\d+w$/u;
const VOLTAGE_TOKEN_PATTERN = /^\d+v$/u;
const REFRESH_RATE_TOKEN_PATTERN = /^\d+hz$/u;
const HARDWARE_TIER_TOKEN_PATTERN =
  /^(?:coreultra\d+|rtx\d+|corei[3579]|i[3579]|\d{3,}(?:[uhtpkgfy]|h[rsx]))$/u;
const CPU_TIER_TOKEN_PATTERN =
  /^(?:coreultra\d+|corei[3579]|i[3579]|\d{3,}(?:[uhtpkgfy]|h[rsx]))$/u;
const GPU_TIER_TOKEN_PATTERN = /^rtx\d+$/u;

function matchesTokenMultiset(tokens: string[], expected: string[]) {
  const sortedTokens = [...tokens].sort();
  const sortedExpected = [...expected].sort();
  return (
    sortedTokens.length === sortedExpected.length &&
    sortedTokens.every((token, index) => token === sortedExpected[index])
  );
}

function matchesExpectedGroup(
  group: string,
  occurrenceTokens: string[],
  expectedTokens: string[]
) {
  if (
    [
      'connectivity',
      'sim',
      'color',
      'hardware',
      'cpu-hardware',
      'gpu-hardware',
    ].includes(group)
  ) {
    return matchesTokenMultiset(occurrenceTokens, expectedTokens);
  }
  return expectedTokens.every((token) => occurrenceTokens.includes(token));
}

function getTokenGroup(token: string, index: number, tokens: string[]) {
  if (CONNECTIVITY_TOKENS.has(token)) {
    return 'connectivity';
  }
  if (SIM_MODE_TOKENS.has(token)) {
    return 'sim';
  }
  if (STORAGE_TOKEN_PATTERN.test(token)) {
    return 'storage';
  }
  if (DIMENSION_TOKEN_PATTERN.test(token)) {
    return 'dimension';
  }
  if (BATTERY_CAPACITY_TOKEN_PATTERN.test(token)) {
    return 'battery-capacity';
  }
  if (WATTAGE_TOKEN_PATTERN.test(token)) {
    return 'wattage';
  }
  if (VOLTAGE_TOKEN_PATTERN.test(token)) {
    return 'voltage';
  }
  if (REFRESH_RATE_TOKEN_PATTERN.test(token)) {
    return 'refresh-rate';
  }
  if (
    isProductVariantRegionToken(token, {
      isTerminal: index === tokens.length - 1,
      nextToken: tokens[index + 1],
    })
  ) {
    return 'region';
  }
  if (CPU_TIER_TOKEN_PATTERN.test(token)) {
    return 'cpu-hardware';
  }
  if (GPU_TIER_TOKEN_PATTERN.test(token)) {
    return 'gpu-hardware';
  }
  if (HARDWARE_TIER_TOKEN_PATTERN.test(token)) {
    return 'hardware';
  }
  if (isProductVariantColorToken(token)) {
    return 'color';
  }
  return 'other';
}

function groupExpectedTokens(discriminatorTokens: string[]) {
  const groups = new Map<string, string[]>();
  for (const [index, token] of discriminatorTokens.entries()) {
    const group = getTokenGroup(token, index, discriminatorTokens);
    groups.set(group, [...(groups.get(group) ?? []), token]);
  }
  return groups;
}

/** Matches strict compare variants or the variant groups explicitly named by a PDP guide. */
export function matchesVariantDiscriminatorTokens(
  occurrenceTokens: string[],
  discriminatorTokens: string[],
  allowPartialGroups = false,
  allowMissingGroups = false
) {
  const normalizedOccurrence = normalizeVariantDiscriminatorTokens(
    occurrenceTokens
  ).filter(
    (token, index, tokens) =>
      !(token === 'black' && tokens[index + 1] === 'friday')
  );
  const normalizedDiscriminators =
    normalizeVariantDiscriminatorTokens(discriminatorTokens);
  if (!allowPartialGroups) {
    return Array.from(groupExpectedTokens(normalizedDiscriminators)).every(
      ([group, expected]) =>
        matchesExpectedGroup(
          group,
          normalizedOccurrence.filter(
            (token, index) =>
              getTokenGroup(token, index, normalizedOccurrence) === group
          ),
          expected
        )
    );
  }

  const expectedGroups = groupExpectedTokens(normalizedDiscriminators);
  let matchedGroup = false;
  for (const [group, expected] of expectedGroups) {
    const occurrenceMentionsGroup = normalizedOccurrence.some(
      (token, index) =>
        getTokenGroup(token, index, normalizedOccurrence) === group
    );
    if (!occurrenceMentionsGroup) {
      continue;
    }
    const occurrenceGroupTokens = normalizedOccurrence.filter(
      (token, index) =>
        getTokenGroup(token, index, normalizedOccurrence) === group
    );
    if (!matchesExpectedGroup(group, occurrenceGroupTokens, expected)) {
      return false;
    }
    matchedGroup = true;
  }
  return matchedGroup || allowMissingGroups;
}
