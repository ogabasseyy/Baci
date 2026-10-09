/**
 * Resolve `var()` references against same-block custom properties.
 * A handoff can hide content behind `--state:none;display:var(
 * --state)`, which the browser resolves but a literal comparison
 * misses — publishing the draft note once sanitization strips the
 * style. Only the element's own declaration block resolves (no
 * inheritance: pasted fragments carry no ancestor styles). Names are
 * case-sensitive per CSS; fallbacks apply when the property is
 * missing or cyclic, and cyclic chains resolve to nothing (the
 * declaration is guaranteed-invalid, so the property stays visible).
 * Unresolvable references stay literal, which no hiding keyword
 * matches — failing visible, exactly like the browser's invalid
 * declaration.
 */
export function resolveCssVariableReferences(
  value: string,
  customs: ReadonlyMap<string, string>,
  seen: readonly string[] = []
): string {
  let output = '';
  let rest = value;
  for (;;) {
    const start = rest.indexOf('var(');
    if (start === -1) return output + rest;
    // Balance to the matching close so fallbacks containing
    // functions (`var(--a, rgb(1, 2, 3))`) split correctly; an
    // unbalanced opener stays literal and matches nothing hiding.
    let depth = 0;
    let end = -1;
    for (let i = start + 3; i < rest.length; i += 1) {
      if (rest[i] === '(') depth += 1;
      else if (rest[i] === ')') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) return output + rest;
    output += rest.slice(0, start);
    const inner = rest.slice(start + 4, end);
    rest = rest.slice(end + 1);
    const comma = topLevelComma(inner);
    const name = (comma === -1 ? inner : inner.slice(0, comma)).trim();
    const fallback = comma === -1 ? null : inner.slice(comma + 1).trim();
    if (!name.startsWith('--') || seen.includes(name)) {
      // Malformed names and cycles resolve to nothing; a fallback
      // still applies, itself resolved for nested references.
      if (fallback !== null) {
        output += resolveCssVariableReferences(fallback, customs, seen);
      }
      continue;
    }
    const defined = customs.get(name);
    if (defined === undefined) {
      if (fallback !== null) {
        output += resolveCssVariableReferences(fallback, customs, seen);
      }
      continue;
    }
    output += resolveCssVariableReferences(defined, customs, [...seen, name]);
  }
}

function topLevelComma(text: string): number {
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') depth -= 1;
    else if (text[i] === ',' && depth === 0) return i;
  }
  return -1;
}
