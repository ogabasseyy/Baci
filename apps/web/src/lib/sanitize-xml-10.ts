/**
 * Removes code points that XML 1.0 cannot represent.
 * Nullish input yields an empty string so nullable DB columns degrade
 * gracefully instead of throwing inside feed builders.
 */
export function stripInvalidXml10Characters(
  value: string | null | undefined
): string {
  if (typeof value !== 'string') {
    return '';
  }
  let result = '';
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint === 0x9 ||
      codePoint === 0xa ||
      codePoint === 0xd ||
      (codePoint !== undefined &&
        ((codePoint >= 0x20 && codePoint <= 0xd7ff) ||
          (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
          (codePoint >= 0x10000 && codePoint <= 0x10ffff)))
    ) {
      result += character;
    }
  }
  return result;
}
