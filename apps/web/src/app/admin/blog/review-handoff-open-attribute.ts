/**
 * Whether a raw tag carries the boolean `open` attribute. Any
 * presence (even `open=""` or `open="false"`) counts. Valueless
 * attributes never reach tagAttributes, so match the raw tag with
 * quoted values blanked: data-open and a title mentioning "open"
 * must not count.
 */
export function hasOpenAttribute(tag: string): boolean {
  const unquoted = tag.replace(/"[^"]*"|'[^']*'/g, '""');
  return /(?:\s|^)open(?:\s*=\s*(?:""|[^\s>]+))?(?=[\s/>])/i.test(unquoted);
}
