// Match an existing class value however quoted: the lazy unquoted
// branch stops at whitespace or the tag end, so a self-closing
// slash stays outside the value instead of joining it.
const CLASS_ATTRIBUTE_PATTERN =
  /\sclass=(?:"([^"]*)"|'([^']*)'|([^\s>]*?))(\s|\/?>)/i;

/**
 * Append the `hidden` marker to a tag's class list, preserving its
 * quote style. The browser keeps the first of duplicate class
 * attributes and ignores the rest, so an existing value — quoted
 * or bare — is rewritten in place instead of appending a second
 * attribute the parser would discard.
 */
export function addHiddenClass(tag: string): string {
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
        ? ` class="${doubleQuoted} hidden"${tail}`
        : singleQuoted !== undefined
          ? ` class='${singleQuoted} hidden'${tail}`
          : ` class="${unquoted ?? ''} hidden"${tail}`
  );
  if (merged !== tag) return merged;
  return tag.replace(/\s*(\/?)>$/, ' class="hidden"$1>');
}
