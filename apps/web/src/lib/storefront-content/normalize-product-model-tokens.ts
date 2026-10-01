import { PRODUCT_VARIANT_COLOR_TOKENS } from '@/config/product-variant-color-tokens';
import { isProductVariantRegionToken } from './is-product-variant-region-token';
import { modelTokenMatchers } from './model-token-matchers';
import { stripModelMetadataSuffixes } from './strip-model-metadata-suffixes';
import { stripTrailingWirelessAudioDescriptor } from './strip-trailing-wireless-audio-descriptor';
import { stripUsedDeviceConditionMetadata } from './strip-used-device-condition-metadata';

const MERCHANDISING_ONLY_TOKENS = new Set([
  'clearance',
  'new',
  'nfid',
  'open',
  'premium',
  'refurb',
  'refurbished',
  'sale',
  'sealed',
  'used',
]);
const MERCHANDISING_SUFFIX_TOKENS = new Set([
  ...PRODUCT_VARIANT_COLOR_TOKENS,
  ...MERCHANDISING_ONLY_TOKENS,
]);
const LEADING_CONDITION_TOKENS = new Set(
  [...MERCHANDISING_ONLY_TOKENS].filter((token) => token !== 'nfid')
);
const CONNECTIVITY_MARKER_TOKENS = new Set([
  'dual',
  'e',
  'nano',
  'physical',
  'single',
]);
const LEADING_CONNECTIVITY_DESCRIPTOR_TOKENS = new Set([
  'portable',
  'speaker',
  'headphones',
  'earbuds',
]);
const DISPLAY_SUFFIX_MARKER_TOKENS = new Set([
  '4k',
  '8k',
  'display',
  'fhd',
  'inch',
  'ips',
  'oled',
  'retina',
  'screen',
  'touchscreen',
  'uhd',
]);
const COLOR_MODIFIER_TOKENS = new Set([
  'black',
  'natural',
  'sierra',
  'space',
  'titanium',
]);
const { isConvertibleInConnector } = modelTokenMatchers;

function stripFirstMatchingSuffix(
  tokens: string[],
  predicate: (token: string, index: number) => boolean
) {
  const suffixIndex = tokens.findIndex(predicate);
  return suffixIndex >= 0 ? tokens.slice(0, suffixIndex) : tokens;
}
function stripColorSuffix(tokens: string[]) {
  const colorIndex = tokens.findIndex(
    (token, index) =>
      PRODUCT_VARIANT_COLOR_TOKENS.has(token) &&
      isTerminalColorSuffix(tokens, index)
  );
  if (colorIndex < 0) {
    return tokens;
  }
  let suffixStart = colorIndex;
  while (
    suffixStart > 0 &&
    COLOR_MODIFIER_TOKENS.has(tokens[suffixStart - 1] ?? '')
  ) {
    suffixStart -= 1;
  }
  return tokens.slice(0, suffixStart);
}
function isTerminalColorSuffix(tokens: string[], index: number) {
  return tokens
    .slice(index + 1)
    .every(
      (token) => MERCHANDISING_SUFFIX_TOKENS.has(token) || /^\d/u.test(token)
    );
}
function stripOptionalConnectivitySuffix(tokens: string[]) {
  const suffixIndex = tokens.findIndex(
    (token, index) =>
      token === 'esim' ||
      token === 'lte' ||
      token === 'cellular' ||
      token === 'bluetooth' ||
      token === 'bt' ||
      token === 'gps' ||
      token === 'wifi' ||
      (token === 'wi' && tokens[index + 1] === 'fi') ||
      (token === 'sim' &&
        CONNECTIVITY_MARKER_TOKENS.has(tokens[index - 1] ?? ''))
  );
  if (suffixIndex < 0) {
    return tokens;
  }

  let markerIndex = suffixIndex - 1;
  while (
    markerIndex >= 0 &&
    CONNECTIVITY_MARKER_TOKENS.has(tokens[markerIndex] ?? '')
  ) {
    markerIndex -= 1;
  }
  if (markerIndex < 0) {
    const leadingTokens = tokens.slice(suffixIndex + 1);
    let firstModelIndex = 0;
    while (
      firstModelIndex < leadingTokens.length &&
      LEADING_CONNECTIVITY_DESCRIPTOR_TOKENS.has(
        leadingTokens[firstModelIndex] ?? ''
      )
    ) {
      firstModelIndex += 1;
    }
    return leadingTokens.slice(firstModelIndex);
  }
  let modelEndIndex = markerIndex + 1;
  while (
    modelEndIndex > 0 &&
    LEADING_CONNECTIVITY_DESCRIPTOR_TOKENS.has(tokens[modelEndIndex - 1] ?? '')
  ) {
    modelEndIndex -= 1;
  }
  return tokens.slice(0, modelEndIndex);
}
function stripDecimalDisplaySuffix(
  tokens: string[],
  stripTerminalDisplay = false
) {
  const decimalIndex = tokens.findLastIndex((token, index) => {
    const nextToken = tokens[index + 1] ?? '';
    if (!/^\d{1,2}$/u.test(token) || !/^\d$/u.test(nextToken)) {
      return false;
    }

    const displaySize = Number(`${token}.${nextToken}`);
    const isTerminalDisplay =
      stripTerminalDisplay &&
      index + 2 === tokens.length &&
      displaySize >= 10 &&
      displaySize <= 20;
    return (
      displaySize >= 5 &&
      displaySize <= 20 &&
      (isTerminalDisplay ||
        tokens
          .slice(index + 2)
          .some((suffixToken) =>
            DISPLAY_SUFFIX_MARKER_TOKENS.has(suffixToken)
          ) ||
        (tokens.length > index + 2 &&
          tokens
            .slice(index + 2)
            .every((suffixToken) => /^\d+(?:gb|tb|mb)$/u.test(suffixToken))))
    );
  });

  if (decimalIndex <= 0) {
    return tokens;
  }
  let suffixEnd = decimalIndex + 2;
  if (tokens[suffixEnd] === 'inch') {
    suffixEnd += 1;
  }
  while (
    suffixEnd < tokens.length &&
    DISPLAY_SUFFIX_MARKER_TOKENS.has(tokens[suffixEnd] ?? '')
  ) {
    suffixEnd += 1;
  }
  if (tokens[suffixEnd] === 'non' && tokens[suffixEnd + 1] === 'touch') {
    suffixEnd += 2;
  }
  return [...tokens.slice(0, decimalIndex), ...tokens.slice(suffixEnd)];
}
function stripOptionalFeatureSuffix(tokens: string[]) {
  const touchBarIndex = tokens.findIndex(
    (token, index) =>
      token === 'touchbar' || (token === 'touch' && tokens[index + 1] === 'bar')
  );
  const allInOneIndex = tokens.findIndex(
    (token, index) =>
      token === 'all' &&
      tokens[index + 1] === 'in' &&
      tokens[index + 2] === 'one'
  );
  const ancIndex = tokens.findIndex(
    (token, index) =>
      token === 'with' &&
      tokens[index + 1] === 'active' &&
      tokens[index + 2] === 'noise' &&
      tokens[index + 3] === 'cancellation'
  );
  const suffixIndex = [
    touchBarIndex,
    allInOneIndex >= 0 && tokens.slice(allInOneIndex + 3).includes('printer')
      ? allInOneIndex
      : -1,
    ancIndex,
  ].find((index) => index >= 0);
  return suffixIndex !== undefined ? tokens.slice(0, suffixIndex) : tokens;
}
function isInternalGameTitleToken(
  tokens: string[],
  index: number,
  preserveGameTitleTokens: boolean
) {
  return (
    preserveGameTitleTokens &&
    tokens[index] === 'new' &&
    tokens
      .slice(index + 1)
      .some((token) => !MERCHANDISING_SUFFIX_TOKENS.has(token))
  );
}

/** Removes catalog suffixes that describe merchandising, region, or connectivity. */
export function normalizeProductModelTokens(
  tokens: string[],
  preserveGameTitleTokens = false,
  stripTerminalDisplay = false
) {
  const preservesLeadingGameTitle =
    preserveGameTitleTokens && isInternalGameTitleToken(tokens, 0, true);
  const withoutLeadingCondition =
    LEADING_CONDITION_TOKENS.has(tokens[0] ?? '') && !preservesLeadingGameTitle
      ? tokens.slice(1)
      : tokens;
  const withoutMerchandising = preserveGameTitleTokens
    ? stripFirstMatchingSuffix(
        withoutLeadingCondition,
        (token, index) =>
          index > 0 &&
          MERCHANDISING_SUFFIX_TOKENS.has(token) &&
          !isInternalGameTitleToken(
            withoutLeadingCondition,
            index,
            preserveGameTitleTokens
          ) &&
          (!PRODUCT_VARIANT_COLOR_TOKENS.has(token) ||
            (!preserveGameTitleTokens &&
              isTerminalColorSuffix(withoutLeadingCondition, index)))
      )
    : stripColorSuffix(
        stripFirstMatchingSuffix(
          withoutLeadingCondition,
          (token, index) =>
            index > 0 &&
            MERCHANDISING_ONLY_TOKENS.has(token) &&
            !isInternalGameTitleToken(
              withoutLeadingCondition,
              index,
              preserveGameTitleTokens
            )
        )
      );
  const withoutConnectivity =
    stripOptionalConnectivitySuffix(withoutMerchandising);
  const withoutDisplaySuffix = stripDecimalDisplaySuffix(
    withoutConnectivity,
    stripTerminalDisplay
  );
  const withoutFeature = stripOptionalFeatureSuffix(withoutDisplaySuffix);
  const withoutWirelessDescriptor =
    stripTrailingWirelessAudioDescriptor(withoutFeature);
  const withoutConditionMetadata = stripUsedDeviceConditionMetadata(
    withoutWirelessDescriptor
  );
  const withoutSplitCapacity = stripModelMetadataSuffixes(
    withoutConditionMetadata
  );

  return withoutSplitCapacity.filter(
    (token, index) =>
      preserveGameTitleTokens ||
      !isProductVariantRegionToken(token, {
        isTerminal: index === withoutSplitCapacity.length - 1,
        nextToken: withoutSplitCapacity[index + 1],
      }) ||
      isConvertibleInConnector(withoutSplitCapacity, index) ||
      (token === 'in' &&
        withoutSplitCapacity[index - 1] === 'all' &&
        withoutSplitCapacity[index + 1] === 'one')
  );
}
