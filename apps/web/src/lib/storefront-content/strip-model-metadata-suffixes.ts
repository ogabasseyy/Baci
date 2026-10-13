const ORDINAL_PATTERN = /^(\d+)(?:st|nd|rd|th)$/u;

function stripTerminalConnectorSuffix(tokens: string[]) {
  const [connector = '', connectorType = ''] = tokens.slice(-2);
  return ['type', 'usb'].includes(connector) && connectorType === 'c'
    ? tokens.slice(0, -2)
    : tokens;
}

function normalizeOrdinalGeneration(tokens: string[]) {
  const withoutConnector = stripTerminalConnectorSuffix(tokens);
  if (
    withoutConnector.length === tokens.length &&
    !tokens.includes('airpods')
  ) {
    return tokens;
  }
  const normalized: string[] = [];
  for (let index = 0; index < withoutConnector.length; index += 1) {
    const generation = withoutConnector[index]?.match(ORDINAL_PATTERN)?.[1];
    if (
      generation &&
      ['gen', 'generation'].includes(withoutConnector[index + 1] ?? '')
    ) {
      normalized.push(generation);
      index += 1;
      continue;
    }
    normalized.push(withoutConnector[index] ?? '');
  }
  return normalized;
}

function stripChargingCaseSuffix(tokens: string[]) {
  if (tokens.at(-1) !== 'case') {
    return tokens;
  }
  const withIndex = tokens.lastIndexOf('with');
  const phraseStart = withIndex >= 0 ? withIndex : tokens.length - 2;
  const suffix = tokens.slice(phraseStart);
  const isChargingCasePhrase =
    suffix.length >= 2 &&
    suffix
      .slice(withIndex >= 0 ? 1 : 0, -1)
      .every((token) => ['charging', 'magsafe'].includes(token));
  return isChargingCasePhrase ? tokens.slice(0, phraseStart) : tokens;
}

function stripSplitCapacitySuffix(tokens: string[]) {
  const normalizedTokens: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? '';
    if (
      /^\d+$/u.test(token) &&
      ['gb', 'tb', 'mb'].includes(tokens[index + 1] ?? '')
    ) {
      index += 1;
      continue;
    }
    normalizedTokens.push(token);
  }
  return normalizedTokens;
}

export function stripModelMetadataSuffixes(tokens: string[]) {
  return stripSplitCapacitySuffix(
    stripChargingCaseSuffix(normalizeOrdinalGeneration(tokens))
  );
}
