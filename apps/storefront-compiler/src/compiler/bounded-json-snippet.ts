export function buildBoundedCatalogJsonSnippet(): string {
  return `
const MAX_CATALOG_RESPONSE_BYTES = 262144;

async function readBoundedCatalogJson(res, maxBytes) {
  const declaredLen =
    res.headers && typeof res.headers.get === 'function'
      ? res.headers.get('content-length')
      : null;
  if (declaredLen !== null && declaredLen !== '') {
    const parsedLen = Number(declaredLen);
    if (!Number.isFinite(parsedLen) || parsedLen < 0 || parsedLen > maxBytes) {
      try {
        await res.body?.cancel?.();
      } catch {}
      return null;
    }
  }
  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk =
          value instanceof Uint8Array ? value : new Uint8Array(value);
        total += chunk.byteLength;
        if (total > maxBytes) {
          try {
            await reader.cancel();
          } catch {}
          return null;
        }
        chunks.push(chunk);
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {}
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (let i = 0; i < chunks.length; i++) {
      merged.set(chunks[i], offset);
      offset += chunks[i].byteLength;
    }
    return JSON.parse(new TextDecoder().decode(merged));
  }
  const text = await res.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    return null;
  }
  return JSON.parse(text);
}
`;
}
