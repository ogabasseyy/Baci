const HTML_TEXT_UNESCAPE_REGEX =
  /&(?:amp|lt|gt|quot|apos|#39|nbsp|copy|reg|trade|mdash|ndash|hellip|lsquo|rsquo|ldquo|rdquo|#\d+|#x[\da-f]+);/gi;
const HTML_TEXT_UNESCAPE_ENTITIES =
  "&amp;=&|&lt;=<|&gt;=>|&quot;=\"|&apos;='|&#39;='|&nbsp;=\u00a0|&copy;=\u00a9|&reg;=\u00ae|&trade;=\u2122|&mdash;=\u2014|&ndash;=\u2013|&hellip;=\u2026|&lsquo;=\u2018|&rsquo;=\u2019|&ldquo;=\u201c|&rdquo;=\u201d";
const HTML_TEXT_UNESCAPE_MAP: Record<string, string> = Object.fromEntries(
  HTML_TEXT_UNESCAPE_ENTITIES.split('|').map((entry) => {
    const separatorIndex = entry.indexOf('=');
    return [entry.slice(0, separatorIndex), entry.slice(separatorIndex + 1)];
  })
);

/**
 * Decodes common named and numeric HTML entities in plain caption/body text.
 */
export function unescapeHtmlText(value: string): string {
  if (!value) return '';
  return value.replace(HTML_TEXT_UNESCAPE_REGEX, (match) => {
    const normalizedMatch = match.toLowerCase();
    const mapped = HTML_TEXT_UNESCAPE_MAP[normalizedMatch];
    if (mapped !== undefined) {
      return mapped;
    }

    if (normalizedMatch.startsWith('&#x')) {
      const codePoint = Number.parseInt(normalizedMatch.slice(3, -1), 16);
      return Number.isInteger(codePoint) && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : match;
    }

    if (normalizedMatch.startsWith('&#')) {
      const codePoint = Number.parseInt(normalizedMatch.slice(2, -1), 10);
      return Number.isInteger(codePoint) && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : match;
    }

    return match;
  });
}
