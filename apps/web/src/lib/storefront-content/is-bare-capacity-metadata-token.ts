const BARE_CAPACITY_TOKEN_PATTERN = /^\d{2,4}$/u;
const LABELED_CAPACITY_TOKEN_PATTERN = /^\d+(?:gb|tb|mb)$/u;
const COMMON_CAPACITY_VALUES = new Set([
  '64',
  '128',
  '256',
  '512',
  '1024',
  '2048',
]);

/** Identifies unitless storage values placed before a labeled memory value. */
export function isBareCapacityMetadataToken(tokens: string[], index: number) {
  const previousToken = tokens[index - 1] ?? '';
  const isTerminalCommonCapacity =
    index === tokens.length - 1 &&
    COMMON_CAPACITY_VALUES.has(tokens[index] ?? '');
  const followsEstablishedModel =
    (/[a-z]/u.test(previousToken) && /\d/u.test(previousToken)) ||
    (isTerminalCommonCapacity &&
      (tokens
        .slice(0, index)
        .some((token) => /[a-z]/u.test(token) && /\d/u.test(token)) ||
        /^\d{1,2}$/u.test(previousToken)));
  return (
    BARE_CAPACITY_TOKEN_PATTERN.test(tokens[index] ?? '') &&
    followsEstablishedModel &&
    (tokens
      .slice(index + 1)
      .some((token) => LABELED_CAPACITY_TOKEN_PATTERN.test(token)) ||
      isTerminalCommonCapacity)
  );
}
