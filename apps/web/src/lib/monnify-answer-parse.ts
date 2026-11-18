const KEY_VALUE_PAIR = /^\s*([A-Za-z_][\w.[\]-]*)\s*[=:]\s*(.*?)\s*$/;

/**
 * Tolerant form decoding: each valid %XX run is decoded on its own, so one
 * stray "%" never leaves the rest of the value encoded.
 */
function decode(value: string): string {
  return value.replace(/\+/g, ' ').replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      return run;
    }
  });
}

/**
 * "responseBody[transactionStatus]" and "responseBody.transactionStatus" split
 * into their path ["responseBody", "transactionStatus"], so nesting is kept:
 * a nested reference is classified like the JSON equivalent, not like a
 * top-level echo.
 */
function keyPath(key: string): string[] {
  return (
    key
      .replace(/\[([^\]]*)\]/g, '.$1')
      .split('.')
      .map((part) => part.trim())
      // Indexed arrays ("responseCode[0]") keep their parent key: the index
      // is dropped, and a repeated key is kept as separate entries.
      .filter((part) => part !== '' && !/^\d+$/.test(part))
  );
}

type FormValue = string | boolean | null;

/** Builds { a: { b: value } } from a path ["a", "b"]. */
function nest(path: string[], value: FormValue): Record<string, unknown> {
  return path.reduceRight<Record<string, unknown>>(
    (inner, part, index) =>
      index === path.length - 1 ? { [part]: value } : { [part]: inner },
    {}
  );
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
  const entries: [string[], FormValue][] = [];
  for (const segment of segments) {
    // Decode the key before checking its shape, so percent-encoded brackets
    // ("responseBody%5BvendStatus%5D") still parse.
    const separator = segment.search(/[=:]/);
    const match =
      separator > 0
        ? KEY_VALUE_PAIR.exec(
            `${decode(segment.slice(0, separator))}=${segment.slice(separator + 1)}`
          )
        : null;
    if (!match) {
      return null;
    }
    const path = keyPath(match[1]);
    if (path.length === 0) {
      return null;
    }
    entries.push([path, coerce(decode(match[2]))]);
  }
  // Flat bodies stay one object. A repeated key or any nesting becomes a
  // list of one-pair (possibly nested) objects, each classified on its own,
  // so a later value never erases an earlier fail-closed one
  // ("status=FAILED&status=false") and nesting is never merged away.
  const keys = entries.map(([path]) => path.join('.'));
  const flat = entries.every(([path]) => path.length === 1);
  if (flat && new Set(keys).size === keys.length) {
    return Object.fromEntries(entries.map(([path, value]) => [path[0], value]));
  }
  return entries.map(([path, value]) => nest(path, value));
}
