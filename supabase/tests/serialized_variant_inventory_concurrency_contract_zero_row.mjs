function hasImmediateUnconditionalException(match) {
  if (!match || typeof match.input !== 'string' || match.index === undefined) {
    return false;
  }
  const remainder = match.input.slice(match.index + match[0].length);
  const opening = /^\s*IF\s+NOT\s+FOUND\s+THEN\b/i.exec(remainder);
  if (!opening) return false;
  const body = remainder
    .slice(opening[0].length)
    .replace(/'(?:''|[^'])*'|"(?:""|[^"])*"/g, (literal) =>
      literal.replace(/[^\r\n]/g, ' ')
    );
  let depth = 1;
  for (const token of body.matchAll(
    /\bEND\s+IF\b|\bIF\b|\bRAISE\s+EXCEPTION\b/gi
  )) {
    if (/^END\s+IF/i.test(token[0])) {
      depth -= 1;
      if (depth === 0) return false;
    } else if (/^IF$/i.test(token[0])) {
      depth += 1;
    } else if (depth === 1) {
      return true;
    }
  }
  return false;
}

export { hasImmediateUnconditionalException };
