const REDACTED = '[REDACTED]';

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getPrivateValueVariants(value) {
  const encoded = encodeURIComponent(value);
  const jsonEscaped = JSON.stringify(value).slice(1, -1);
  const base64 = Buffer.from(value).toString('base64');
  return new Set([
    value,
    encoded,
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
          value.split('').map(escapeRegExp).join('(?:\\r\\n|\\r|\\n)*'),
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
