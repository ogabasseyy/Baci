// Strip comments for negative-marker gates, preserving every quoted
// span verbatim: a `/*`, `*/`, or `//` inside '...', "...", or `...`
// is data, not a comment, and removing it could hide a real marker
// (fail-open). Templates are opaque — a comment inside `${}`
// survives, which can only false-fail, never false-pass. A `//` pair
// strips only as the line's first slashes, so regex/division lines
// keep their tails (fail-closed); an unterminated block comment keeps
// the rest of the file for the same reason.

// Every JavaScript line terminator ends a `//` comment: stopping only
// at LF would swallow code after a CR (or U+2028/U+2029) and false-pass
// the negative gate.
function isLineTerminator(ch: string): boolean {
  return ch === '\n' || ch === '\r' || ch === '\u2028' || ch === '\u2029';
}

function lineCommentEnd(source: string, from: number): number {
  let end = source.length;
  for (const terminator of ['\n', '\r', '\u2028', '\u2029']) {
    const at = source.indexOf(terminator, from);
    if (at !== -1 && at < end) {
      end = at;
    }
  }
  return end;
}

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
      if (/[\n\r\u2028\u2029]/.test(source.slice(i, end))) {
        lineHasSlash = false;
      }
      i = end + 2;
      continue;
    }
    if (ch === '/' && source.charAt(i + 1) === '/' && !lineHasSlash) {
      i = lineCommentEnd(source, i + 2);
      continue;
    }
    if (isLineTerminator(ch)) {
      lineHasSlash = false;
    } else if (ch === '/') {
      lineHasSlash = true;
    }
    out += ch;
    i += 1;
  }
  return out;
}
