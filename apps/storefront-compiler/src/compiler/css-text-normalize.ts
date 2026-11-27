function stripCssComments(rawCss: string): string {
  return rawCss.replace(
    /(\\([\s\S])|"(?:[^"\\]|\\[\s\S])*"|'(?:[^'\\]|\\[\s\S])*')|\/\*[\s\S]*?(?:\*\/|$)/g,
    (_match, kept: string | undefined) => (kept !== undefined ? kept : '/**/')
  );
}

function decodeCssEscapes(rawCss: string): string {
  return rawCss.replace(
    /\\([0-9a-fA-F]{1,6})\s?|\\(.)/g,
    (_match, hex: string | undefined, ch: string | undefined) => {
      if (hex !== undefined) {
        const codePoint = Number.parseInt(hex, 16);
        if (
          Number.isFinite(codePoint) &&
          codePoint > 0 &&
          codePoint <= 0x10ffff
        ) {
          return String.fromCodePoint(codePoint);
        }
      }
      return ch ?? '';
    }
  );
}

export function normalizeCssForInspection(rawCss: string): {
  withoutComments: string;
  unescaped: string;
} {
  const withoutComments = stripCssComments(rawCss);
  return {
    withoutComments,
    unescaped: decodeCssEscapes(withoutComments),
  };
}
