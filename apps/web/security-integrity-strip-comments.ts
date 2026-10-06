// Strip comments for negative-marker gates, preserving every quoted
// span verbatim: a `/*`, `*/`, or `//` inside '...', "...", or `...`
// is data, not a comment, and removing it could hide a real marker
// (fail-open). Templates are opaque — a comment inside `${}`
// survives, which can only false-fail, never false-pass. A `//` pair
// strips only as the line's first slashes, so regex/division lines
// keep their tails (fail-closed); an unterminated block comment keeps
// the rest of the file for the same reason.
export function stripComments(source: string): string {
  let out = '';
  let lineHasSlash = false;
  let i = 0;
  while (i < source.length) {
    const ch = source.charAt(i);
    if (ch === '"' || ch === "'" || ch === '`') {
      out += ch;
      i += 1;
      while (i < source.length) {
        const inner = source.charAt(i);
        out += inner;
        i += 1;
        if (inner === '\\' && i < source.length) {
          out += source.charAt(i);
          i += 1;
        } else if (inner === ch) {
          break;
        }
      }
      continue;
    }
    if (ch === '/' && source.charAt(i + 1) === '*') {
      const end = source.indexOf('*/', i + 2);
      if (end === -1) {
        out += source.slice(i);
        return out;
      }
      if (source.slice(i, end).includes('\n')) {
        lineHasSlash = false;
      }
      i = end + 2;
      continue;
    }
    if (ch === '/' && source.charAt(i + 1) === '/' && !lineHasSlash) {
      const end = source.indexOf('\n', i + 2);
      i = end === -1 ? source.length : end;
      continue;
    }
    if (ch === '\n') {
      lineHasSlash = false;
    } else if (ch === '/') {
      lineHasSlash = true;
    }
    out += ch;
    i += 1;
  }
  return out;
}
