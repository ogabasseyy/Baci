const WIRELESS_AUDIO_DESCRIPTOR_TOKENS = new Set([
  'cancelling',
  'canceling',
  'earbuds',
  'headphones',
  'noise',
  'speaker',
]);
const WIRELESS_AUDIO_QUALIFIERS = new Set(['true', 'truly']);

/** Removes a trailing wireless audio description without changing model names. */
export function stripTrailingWirelessAudioDescriptor(tokens: string[]) {
  const wirelessIndex = tokens.indexOf('wireless');
  if (
    wirelessIndex <= 0 ||
    tokens
      .slice(wirelessIndex + 1)
      .some((token) => !WIRELESS_AUDIO_DESCRIPTOR_TOKENS.has(token))
  ) {
    return tokens;
  }
  const descriptorStart = WIRELESS_AUDIO_QUALIFIERS.has(
    tokens[wirelessIndex - 1] ?? ''
  )
    ? wirelessIndex - 1
    : wirelessIndex;
  return tokens.slice(0, descriptorStart);
}
