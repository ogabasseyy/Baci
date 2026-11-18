const KEY_VALUE_PAIR = /^\s*([A-Za-z_][\w.-]*)\s*[=:]\s*(.*?)\s*$/;

function decode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}

/** Form values "true"/"false"/"null" become real booleans/null, like JSON. */
function coerce(value: string): string | boolean | null {
  const lowered = value.trim().toLowerCase();
  if (lowered === 'true') {
    return true;
  }
  if (lowered === 'false') {
    return false;
  }
  if (lowered === 'null') {
    return null;
  }
  return value;
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
  const entries: [string, string | boolean | null][] = [];
  for (const segment of segments) {
    const match = KEY_VALUE_PAIR.exec(segment);
    if (!match) {
      return null;
    }
    entries.push([decode(match[1]), coerce(decode(match[2]))]);
  }
  const keys = entries.map(([key]) => key);
  // A repeated key keeps every value: the body becomes a list of one-pair
  // objects, each classified on its own, so a later value never erases an
  // earlier fail-closed one ("status=FAILED&status=false").
  if (new Set(keys).size !== keys.length) {
    return entries.map(([key, value]) => ({ [key]: value }));
  }
  return Object.fromEntries(entries);
}
