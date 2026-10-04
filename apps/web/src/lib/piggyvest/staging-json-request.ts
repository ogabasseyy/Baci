import 'server-only';
import { isUint8Array } from 'node:util/types';
import {
  PIGGYVEST_STAGING_API_ORIGIN,
  piggyvestStagingConfigurationSchema,
} from '@/schemas/piggyvest-staging-configuration';
import { isPiggyvestInterestRequestPath } from './interest-request-path';
import { PiggyvestStagingJsonRequestError } from './staging-json-request.errors';
import { isPiggyvestTransactionListRequestPath } from './transaction-list-request-path';

const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_RESPONSE_CHUNKS = 1024;

function isSupportedPath(path: string, method: 'GET' | 'POST'): boolean {
  if (typeof path !== 'string') return false;
  if (method === 'POST') {
    return (
      path === '/api/v1/customers' || path === '/api/v1/wallet/sub-account'
    );
  }
  if (method !== 'GET') return false;
  if (isPiggyvestTransactionListRequestPath(path, isCanonicalIdentifier))
    return true;
  if (isPiggyvestInterestRequestPath(path, isCanonicalIdentifier)) return true;
  const wallet = /^\/api\/v1\/wallet\/([^/]+)(?:\/accounts)?$/.exec(path);
  const transaction =
    /^\/api\/v1\/transaction\/([^/?#]+)\?wallet_id=([^&#]+)$/.exec(path);
  if (wallet) return isCanonicalIdentifier(wallet[1]);
  return Boolean(
    transaction &&
      isCanonicalIdentifier(transaction[1]) &&
      isCanonicalIdentifier(transaction[2])
  );
}

function isCanonicalIdentifier(encoded: string): boolean {
  try {
    const walletId = decodeURIComponent(encoded);
    return (
      walletId.length > 0 &&
      walletId.length <= 512 &&
      walletId === walletId.trim() &&
      encodeURIComponent(walletId) === encoded &&
      !/%[0-9a-f]{2}/i.test(walletId) &&
      !Array.from(walletId).some((character) => {
        const code = character.charCodeAt(0);
        return code <= 31 || code === 127;
      }) &&
      !walletId
        .split(/[\\/]/)
        .some((segment) => segment === '.' || segment === '..')
    );
  } catch {
    return false;
  }
}

function discardResponseBody(response: Response): void {
  try {
    void response.body?.cancel().catch(() => undefined);
  } catch {
    return;
  }
}

async function readJson(
  response: Response,
  maxBytes: number,
  deadline: Promise<never>
): Promise<unknown> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    discardResponseBody(response);
    throw new PiggyvestStagingJsonRequestError('RESPONSE_TOO_LARGE');
  }
  if (!response.body) {
    throw new PiggyvestStagingJsonRequestError('INVALID_RESPONSE');
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  let completed = false;
  try {
    while (true) {
      const result = await Promise.race([reader.read(), deadline]);
      if (result.done) {
        completed = true;
        break;
      }
      if (!isUint8Array(result.value)) {
        throw new PiggyvestStagingJsonRequestError('BODY_READ_ERROR');
      }
      byteLength += result.value.byteLength;
      if (byteLength > maxBytes || chunks.length >= MAX_RESPONSE_CHUNKS) {
        throw new PiggyvestStagingJsonRequestError('RESPONSE_TOO_LARGE');
      }
      chunks.push(new Uint8Array(result.value));
    }
  } catch (error) {
    if (error instanceof PiggyvestStagingJsonRequestError) throw error;
    throw new PiggyvestStagingJsonRequestError('BODY_READ_ERROR');
  } finally {
    if (!completed) void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new PiggyvestStagingJsonRequestError('INVALID_RESPONSE');
  }
}

export async function requestPiggyvestStagingJson({
  configuration,
  path,
  method,
  body,
  fetchImplementation,
}: {
  configuration: unknown;
  path: string;
  method: 'GET' | 'POST';
  body?: string;
  fetchImplementation: typeof fetch;
}): Promise<unknown> {
  const parsedConfiguration =
    piggyvestStagingConfigurationSchema.safeParse(configuration);
  if (!parsedConfiguration.success) {
    throw new PiggyvestStagingJsonRequestError('INVALID_CONFIGURATION');
  }
  if (
    !isSupportedPath(path, method) ||
    typeof fetchImplementation !== 'function' ||
    (method === 'GET' && body !== undefined) ||
    (body !== undefined &&
      (typeof body !== 'string' ||
        body.length > MAX_REQUEST_BYTES ||
        new TextEncoder().encode(body).byteLength > MAX_REQUEST_BYTES))
  ) {
    throw new PiggyvestStagingJsonRequestError('INVALID_REQUEST');
  }
  if (body !== undefined) {
    try {
      JSON.parse(body);
    } catch {
      throw new PiggyvestStagingJsonRequestError('INVALID_REQUEST');
    }
  }

  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new PiggyvestStagingJsonRequestError('TIMEOUT'));
      controller.abort();
    }, parsedConfiguration.data.timeoutMs);
  });
  const request = async (): Promise<unknown> => {
    let response: Response;
    try {
      response = await fetchImplementation(
        `${PIGGYVEST_STAGING_API_ORIGIN}${path}`,
        {
          method,
          headers: {
            Authorization: `Bearer ${parsedConfiguration.data.apiSecret}`,
            ...(method === 'POST'
              ? { 'Content-Type': 'application/json' }
              : {}),
          },
          ...(body !== undefined ? { body } : {}),
          cache: 'no-store',
          redirect: 'error',
          signal: controller.signal,
        }
      );
    } catch {
      throw new PiggyvestStagingJsonRequestError(
        controller.signal.aborted ? 'TIMEOUT' : 'NETWORK_ERROR'
      );
    }
    if (controller.signal.aborted) {
      discardResponseBody(response);
      throw new PiggyvestStagingJsonRequestError('TIMEOUT');
    }
    if (
      !response.ok ||
      response.redirected ||
      response.type === 'opaqueredirect'
    ) {
      discardResponseBody(response);
      throw new PiggyvestStagingJsonRequestError('HTTP_STATUS');
    }
    return readJson(
      response,
      parsedConfiguration.data.maxResponseBytes,
      deadline
    );
  };
  try {
    return await Promise.race([request(), deadline]);
  } catch (error) {
    if (error instanceof PiggyvestStagingJsonRequestError) throw error;
    throw new PiggyvestStagingJsonRequestError('BODY_READ_ERROR');
  } finally {
    clearTimeout(timeout);
  }
}
