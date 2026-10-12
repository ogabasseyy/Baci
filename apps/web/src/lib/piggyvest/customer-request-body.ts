import 'server-only';
import type { NextRequest } from 'next/server';
import { CUSTOMER_POLICY_REQUEST_LIMITS as limits } from './customer-policy-handler.constants';

export async function readPiggyvestCustomerRequestBody(
  request: NextRequest
): Promise<unknown> {
  const declaredLength = request.headers.get('content-length');
  if (
    !/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(
      request.headers.get('content-type') ?? ''
    ) ||
    request.headers.has('content-encoding') ||
    (declaredLength !== null && !/^\d+$/.test(declaredLength)) ||
    Number(declaredLength) > limits.maxBodyBytes ||
    !request.body ||
    request.signal.aborted
  )
    throw new Error('Invalid body');
  const reader = request.body.getReader();
  let interrupt: () => void = () => undefined;
  const interrupted = new Promise<never>((_resolve, reject) => {
    interrupt = () => reject(new Error('Body read unavailable'));
  });
  request.signal.addEventListener('abort', interrupt, { once: true });
  const timeout = setTimeout(interrupt, limits.readTimeoutMs);
  const chunks: Uint8Array[] = [];
  let size = 0;
  let complete = false;
  try {
    while (true) {
      const chunk = await Promise.race([reader.read(), interrupted]);
      if (chunk.done) {
        complete = true;
        break;
      }
      size += chunk.value.byteLength;
      if (size > limits.maxBodyBytes || chunks.length >= limits.maxBodyChunks)
        throw new Error('Invalid body');
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    if (declaredLength !== null && Number(declaredLength) !== size)
      throw new Error('Invalid body');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener('abort', interrupt);
    if (!complete) void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
