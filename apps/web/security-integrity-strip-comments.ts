// Strip a trailing `//` comment only when it is unambiguously a
// comment: the text before it holds no quotes, backticks, or slashes
// (so `//` inside strings, URLs, and regex/division sequences never
// strips), and it ends at a line start, whitespace, or code punctuator
// (so `https://…` never strips). When in doubt the tail is kept: an
// unstripped comment can only false-fail a negative-marker gate
// (fail-closed), while over-stripping could hide a real marker.
function stripTrailingComment(line: string): string {
  let from = 0;
  for (;;) {
    const index = line.indexOf('//', from);
    if (index === -1) {
      return line;
    }
    const before = line.slice(0, index);
    if (
      !/["'`/]/.test(before) &&
      (before === '' || /[\s;{}()]$/.test(before))
    ) {
      return before;
    }
    from = index + 2;
  }
}

// Strip comments for negative-marker gates: block comments, full-line
// `//` comments, and unambiguous trailing `//` comments (see above).
export function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .map(stripTrailingComment)
    .join('\n');
}
