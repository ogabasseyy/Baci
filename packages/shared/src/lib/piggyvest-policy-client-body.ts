const MAX_BODY_BYTES = 262144;
const MAX_BODY_CHUNKS = 1024;

export async function readPiggyvestPolicyClientBody(
  response: Response,
  interrupted: Promise<never>
): Promise<unknown> {
  const length = response.headers.get('content-length');
  if (
    !/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(
      response.headers.get('content-type') ?? ''
    ) ||
    response.headers.has('content-encoding') ||
    !response.body ||
    (length !== null &&
      (!/^[0-9]+$/.test(length) || Number(length) > MAX_BODY_BYTES))
  )
    throw new Error('Policy unavailable');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let complete = false;
  try {
    while (true) {
      const chunk = await Promise.race([reader.read(), interrupted]);
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BODY_BYTES || chunks.length >= MAX_BODY_CHUNKS)
        throw new Error('Policy unavailable');
      chunks.push(chunk.value);
    }
    if (length !== null && Number(length) !== bytes)
      throw new Error('Policy unavailable');
    const encoded = chunks
      .map((chunk) =>
        Array.from(
          chunk,
          (byte) => `%${byte.toString(16).padStart(2, '0')}`
        ).join('')
      )
      .join('');
    const result: unknown = JSON.parse(decodeURIComponent(encoded));
    complete = true;
    return result;
  } finally {
    if (!complete) void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
