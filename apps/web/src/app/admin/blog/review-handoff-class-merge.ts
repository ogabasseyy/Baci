// Match an existing class value however quoted: the lazy unquoted
// branch stops at whitespace or the tag end, so a self-closing
// slash stays outside the value instead of joining it.
const CLASS_ATTRIBUTE_PATTERN =
  /\sclass=(?:"([^"]*)"|'([^']*)'|([^\s>]*?))(\s|\/?>)/i;

/**
 * Append a hiding utility to a tag's class list, preserving its
 * quote style. The browser keeps the first of duplicate class
 * attributes and ignores the rest, so an existing value — quoted
 * or bare — is rewritten in place instead of appending a second
 * attribute the parser would discard.
 */
export function addUtilityClass(tag: string, utility: string): string {
  const merged = tag.replace(
    CLASS_ATTRIBUTE_PATTERN,
    (
      _match: string,
      doubleQuoted: string | undefined,
      singleQuoted: string | undefined,
      unquoted: string | undefined,
      tail: string
    ) =>
      doubleQuoted !== undefined
        ? ` class="${doubleQuoted} ${utility}"${tail}`
        : singleQuoted !== undefined
          ? ` class='${singleQuoted} ${utility}'${tail}`
          : ` class="${unquoted ?? ''} ${utility}"${tail}`
  );
  if (merged !== tag) return merged;
  return tag.replace(/\s*(\/?)>$/, ` class="${utility}"$1>`);
}
