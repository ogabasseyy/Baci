const IMPORTANT_SUFFIX_PATTERN = /!\s*important\s*$/i;

function stripCssComments(style: string): string {
  // Comments can hide anywhere outside strings — inside values
  // (`display:/*x*/none`), names, even around `!important` — so
  // strip them before declaration splitting. Quoted strings keep
  // their text (`content:"/*"` is two characters, not a comment),
  // and an unterminated comment runs to the end per CSS. Backslash
  // escapes keep a quote inside its string.
  let output = '';
  let index = 0;
  let quote: string | null = null;
  while (index < style.length) {
    const char = style[index] ?? '';
    if (quote !== null) {
      output += char;
      if (char === '\\' && index + 1 < style.length) {
        output += style[index + 1] ?? '';
        index += 2;
        continue;
      }
      if (char === quote) quote = null;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      output += char;
      index += 1;
      continue;
    }
    if (char === '/' && style[index + 1] === '*') {
      const end = style.indexOf('*/', index + 2);
      // CSS strips comments pre-tokenization (so `n/** /o/**/ne`
      // reads as `none`); dropping them outright is exactly that.
      index = end === -1 ? style.length : end + 2;
      continue;
    }
    output += char;
    index += 1;
  }
  return output;
}

function isImportantDeclaration(value: string): boolean {
  // CSS allows whitespace between `!` and `important`, matched
  // ASCII case-insensitively like every other declaration keyword.
  return IMPORTANT_SUFFIX_PATTERN.test(value);
}

function normalizeDeclarationValue(value: string): string {
  // Values stay verbatim: custom-property references are
  // case-sensitive (`var(--Hide)` is not `var(--hide)`), so case
  // folding happens at compare time, not parse time.
  return value.replace(IMPORTANT_SUFFIX_PATTERN, '').trim();
}

/**
 * Parse a style attribute into winning declarations per property.
 * Importance beats order, mirroring the CSS cascade; custom
 * property names stay case-sensitive while every other property
 * matches ASCII case-insensitively.
 */
export function finalDeclarationsForStyle(
  style: string
): Map<string, { important: boolean; value: string }> {
  const finals = new Map<string, { important: boolean; value: string }>();
  for (const declaration of stripCssComments(style).split(';')) {
    const separator = declaration.indexOf(':');
    if (separator === -1) continue;
    const rawName = declaration.slice(0, separator).trim();
    // Custom property names are case-sensitive (`--State` is not
    // `--state`); every other property matches ASCII
    // case-insensitively.
    const name = rawName.startsWith('--') ? rawName : rawName.toLowerCase();
    const raw = declaration.slice(separator + 1);
    const important = isImportantDeclaration(raw);
    const existing = finals.get(name);
    if (existing?.important && !important) continue;
    finals.set(name, { important, value: normalizeDeclarationValue(raw) });
  }
  return finals;
}
