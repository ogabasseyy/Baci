import 'server-only';

async function readBoundedJson(
  response: Response,
  maxResponseBytes: number,
  deadline: Promise<never>
): Promise<unknown> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
    void response.body?.cancel().catch(() => undefined);
    throw new Error('PROVIDER_RESPONSE_TOO_LARGE');
  }
  if (!response.body) throw new Error('PROVIDER_INVALID_RESPONSE');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  let complete = false;
  try {
    while (true) {
      const result = await Promise.race([reader.read(), deadline]);
      if (result.done) {
        complete = true;
        break;
      }
      length += result.value.byteLength;
      if (length > maxResponseBytes)
        throw new Error('PROVIDER_RESPONSE_TOO_LARGE');
      chunks.push(result.value);
    }
  } finally {
    if (!complete) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new Error('PROVIDER_INVALID_RESPONSE');
  }
}

export async function requestPrefundedCardProviderJson({
  url,
  token,
  timeoutMs,
  maxResponseBytes,
  fetchImplementation,
  init,
}: {
  url: string;
  token: string;
  timeoutMs: number;
  maxResponseBytes: number;
  fetchImplementation: typeof fetch;
  init: RequestInit;
}): Promise<unknown> {
  const controller = new AbortController();
  let rejectDeadline: (reason: Error) => void;
  const deadline = new Promise<never>((_resolve, reject) => {
    rejectDeadline = reject;
  });
  const timeout = setTimeout(() => {
    controller.abort();
    rejectDeadline(new Error('PROVIDER_TIMEOUT'));
  }, timeoutMs);
  try {
    const response = await Promise.race([
      fetchImplementation(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
      }),
      deadline,
    ]);
    if (
      !response.ok ||
      response.redirected ||
      response.type === 'opaqueredirect'
    )
      throw new Error('PROVIDER_HTTP_ERROR');
    return await readBoundedJson(response, maxResponseBytes, deadline);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('PROVIDER_'))
      throw error;
    throw new Error('PROVIDER_UNAVAILABLE');
  } finally {
    clearTimeout(timeout);
  }
}
