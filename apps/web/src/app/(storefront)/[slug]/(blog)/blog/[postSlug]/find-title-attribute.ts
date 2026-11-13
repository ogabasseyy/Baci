/**
 * Locates the `title` attribute inside an `<img>` tag, supporting quoted and
 * unquoted values as well as any HTML whitespace separator after `<img`.
 */
export function findTitleAttribute(
  imgTag: string
): { start: number; end: number; value: string } | null {
  const attributeRegex =
    /\s+([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>]+?)(?=\s|\/?>|$)))?/g;
  const firstWhitespaceIndex = imgTag.search(/\s/);
  if (firstWhitespaceIndex === -1) {
    return null;
  }
  attributeRegex.lastIndex = firstWhitespaceIndex;
  let match = attributeRegex.exec(imgTag);
  while (match !== null) {
    if (match[1]?.toLowerCase() === 'title') {
      return {
        start: match.index,
        end: match.index + match[0].length,
        value: match[2] ?? match[3] ?? match[4] ?? '',
      };
    }
    match = attributeRegex.exec(imgTag);
  }
  return null;
}
