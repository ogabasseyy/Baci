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
  return new Set([
    value,
    encoded,
    encodedWithLowercaseEscapes,
    encoded.replaceAll('%20', '+'),
    jsonEscaped,
    base64,
    base64.replace(/=+$/, ''),
  ].filter(Boolean));
}

export function redactPrivateValues(output, privateValues) {
  let redacted = output;
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

  for (const variant of [...variants].sort((left, right) => right.length - left.length)) {
    redacted = redacted.split(variant).join(REDACTED);
  }
  for (const pattern of wrappedPatterns) {
    redacted = redacted.replace(pattern, REDACTED);
  }

  return redacted;
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
