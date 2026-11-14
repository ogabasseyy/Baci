const REDACTED = '[REDACTED]';

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getPrivateValueVariants(value) {
  const encoded = encodeURIComponent(value);
  const encodedWithLowercaseEscapes = encoded.replace(
    /%[0-9A-F]{2}/g,
    (escape) => escape.toLowerCase()
  );
  const jsonEscaped = JSON.stringify(value).slice(1, -1);
  const base64 = Buffer.from(value).toString('base64');
  const base64Url = base64.replace(/\+/g, '-').replace(/\//g, '_');
  return new Set([
    value,
    encoded,
    encodedWithLowercaseEscapes,
    encoded.replaceAll('%20', '+'),
    jsonEscaped,
    base64,
    base64.replace(/=+$/, ''),
    base64Url,
    base64Url.replace(/=+$/, ''),
  ].filter(Boolean));
}

export function redactPrivateValues(output, privateValues) {
  const variants = new Set();
  const wrappedPatterns = [];

  for (const value of privateValues) {
    if (typeof value !== 'string' || value.length === 0) continue;
    for (const variant of getPrivateValueVariants(value)) {
      variants.add(variant);
    }
    if (value.length >= 8) {
      wrappedPatterns.push(
        new RegExp(
          [...value].map(escapeRegExp).join('(?:\\r\\n|\\r|\\n)?'),
          'g'
        )
      );
    }
  }

  const matches = [];
  for (const variant of variants) {
    for (const match of output.matchAll(new RegExp(escapeRegExp(variant), 'g'))) {
      matches.push({ start: match.index, end: match.index + match[0].length });
    }
  }
  for (const pattern of wrappedPatterns) {
    for (const match of output.matchAll(pattern)) {
      matches.push({ start: match.index, end: match.index + match[0].length });
    }
  }

  matches.sort((left, right) => left.start - right.start || right.end - left.end);
  let redacted = '';
  let cursor = 0;
  for (const match of matches) {
    if (match.start < cursor) {
      // Redact the union when distinct secrets overlap so neither suffix leaks.
      cursor = Math.max(cursor, match.end);
      continue;
    }
    redacted += `${output.slice(cursor, match.start)}${REDACTED}`;
    cursor = match.end;
  }
  return `${redacted}${output.slice(cursor)}`;
}

export function redactPrivateValuesAndLimit(output, privateValues, maxBytes) {
  const redacted = Buffer.from(redactPrivateValues(output, privateValues));
  if (redacted.length <= maxBytes) return redacted.toString('utf8');

  // Redact before truncation so a multiline secret crossing the retained-log
  // boundary cannot leave an unmatched suffix in the diagnostics.
  const retained = redacted.subarray(-maxBytes).toString('utf8');
  const firstLineEnd = retained.indexOf('\n');
  return firstLineEnd === -1 ? '' : retained.slice(firstLineEnd + 1);
}
