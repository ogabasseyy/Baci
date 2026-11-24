const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

type BoundedJsonBodyResult =
  | { body: unknown; ok: true }
  | { ok: false; reason: 'invalid_json' | 'too_large' };

export async function readBoundedJsonBody(
  request: Request,
  maxBytes: number
): Promise<BoundedJsonBodyResult> {
  const contentLength = request.headers.get('content-length');
  if (
    contentLength &&
    /^\d+$/.test(contentLength) &&
    Number(contentLength) > maxBytes
  ) {
    return { ok: false, reason: 'too_large' };
  }

  const reader = request.body?.getReader();
  if (!reader) return { ok: false, reason: 'invalid_json' };

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: 'too_large' };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }

  let bytes: Uint8Array;
  if (chunks.length === 1) {
    bytes = chunks[0];
  } else {
    bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
  }

  try {
    return {
      body: JSON.parse(UTF8_DECODER.decode(bytes)),
      ok: true,
    };
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }
}
