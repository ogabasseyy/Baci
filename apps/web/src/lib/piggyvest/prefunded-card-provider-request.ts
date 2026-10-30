import 'server-only';

async function readBoundedJson(
  response: Response,
  maxResponseBytes: number,
  deadline: Promise<never>,
  abortResponse: () => void
): Promise<unknown> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
    abortResponse();
    try {
      void response.body?.cancel().catch(() => undefined);
    } catch {
      // A failed best-effort body cancellation must not mask the size error.
    }
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
    if (!complete) {
      abortResponse();
      try {
        // Cancellation may itself hang (for example, when a stream's
        // underlying cancel algorithm never settles). Start cleanup and
        // observe rejection, but keep the request deadline authoritative.
        void reader.cancel().catch(() => undefined);
      } catch {
        // Cleanup is best-effort; preserve the read/timeout failure.
      }
    }
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
    ) {
      // Paystack reports definitive request rejections (notably HTTP 400
      // "Duplicate Transaction Reference") as an error status with a
      // JSON body. Attach the bounded body so callers can distinguish a
      // permanent rejection from transport uncertainty; the message stays
      // PROVIDER_HTTP_ERROR so existing failure handling is unchanged.
      const httpError = new Error('PROVIDER_HTTP_ERROR') as Error & {
        httpStatus?: number;
        responseBody?: unknown;
      };
      httpError.httpStatus = response.status;
      try {
        httpError.responseBody = await readBoundedJson(
          response,
          maxResponseBytes,
          deadline,
          () => controller.abort()
        );
      } catch {
        httpError.responseBody = undefined;
      }
      throw httpError;
    }
    return await readBoundedJson(response, maxResponseBytes, deadline, () =>
      controller.abort()
    );
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('PROVIDER_'))
      throw error;
    throw new Error('PROVIDER_UNAVAILABLE');
  } finally {
    clearTimeout(timeout);
  }
}
