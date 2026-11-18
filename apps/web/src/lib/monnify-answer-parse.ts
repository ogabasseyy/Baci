const KEY_VALUE_PAIR = /^\s*([A-Za-z_][\w.-]*)\s*[=:]\s*(.*?)\s*$/;

function decode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}

/**
 * Parses a Monnify error body into an object so structured checks (flags by
 * value, codes, vend evidence) apply to every shape: JSON first, then a
 * form-encoded or "key=value; key: value" body when every segment is a pair.
 * Anything else returns null and is read as plain text.
 */
export function parseMonnifyAnswer(body: string): unknown {
  try {
    const parsed = JSON.parse(body) as unknown;
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
  } catch {
    // Not JSON: try key/value pairs below.
  }
  const segments = body.split(/[&;\n]/).filter((segment) => segment.trim());
  if (segments.length === 0) {
    return null;
  }
  const pairs: Record<string, string> = {};
  for (const segment of segments) {
    const match = KEY_VALUE_PAIR.exec(segment);
    if (!match) {
      return null;
    }
    pairs[decode(match[1])] = decode(match[2]);
  }
  return pairs;
}
