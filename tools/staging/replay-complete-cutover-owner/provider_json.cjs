function requireCondition(condition) {
  if (!condition) throw new Error('provider_crosswalk_refused');
}

function uniqueJson(raw) {
  const tokens =
    raw.match(
      /"(?:[^"\\]|\\.)*"|[{}[\],:]|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|\S/g
    ) || [];
  let offset = 0;
  function value(depth) {
    requireCondition(depth <= 32 && offset < tokens.length);
    const token = tokens[offset++];
    if (token === '{' || token === '[') {
      const end = token === '{' ? '}' : ']';
      const keys = new Set();
      if (tokens[offset] === end) {
        offset++;
        return;
      }
      while (true) {
        if (token === '{') {
          const key = JSON.parse(tokens[offset++]);
          requireCondition(typeof key === 'string' && !keys.has(key));
          keys.add(key);
          requireCondition(tokens[offset++] === ':');
        }
        value(depth + 1);
        const separator = tokens[offset++];
        if (separator === end) return;
        requireCondition(separator === ',');
      }
    } else requireCondition(!['}', ']', ',', ':'].includes(token));
  }
  value(0);
  requireCondition(offset === tokens.length);
  return JSON.parse(raw);
}

async function boundedJson(response, limit, timeout) {
  try {
    requireCondition(Number.isInteger(limit) && limit > 0 && limit <= 1048576);
    const length = response.headers.get('content-length');
    requireCondition(
      length === null || (/^\d+$/.test(length) && Number(length) <= limit)
    );
    requireCondition(response.body);
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    let complete = false;
    try {
      while (true) {
        const result = await Promise.race([reader.read(), timeout]);
        if (result.done) {
          complete = true;
          break;
        }
        size += result.value.byteLength;
        requireCondition(size <= limit);
        chunks.push(result.value);
      }
    } finally {
      if (!complete) void reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    return uniqueJson(
      new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))
    );
  } catch {
    throw new Error('provider_crosswalk_refused');
  }
}

module.exports = boundedJson;
