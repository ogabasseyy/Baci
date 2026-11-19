import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  experienceRunnerExecution,
  experienceRunnerReply,
  experienceRunnerRequest,
} from '../../src/schemas/experience-runner-transport';
import type { QualificationKind } from './local-oci-executor';

const INPUT_LIMIT = 8 * 1024 * 1024;
const OUTPUT_LIMIT = 16 * 1024 * 1024;

export function runnerEndpoint(value: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/v1/execute' ||
    url.origin !== `https://${url.host}` ||
    !url.hostname.includes('.') ||
    url.hostname.endsWith('.localhost') ||
    /^[\d.]+$/.test(url.hostname) ||
    url.hostname.includes(':')
  )
    throw Error('INVALID_RUNNER_ENDPOINT');
  return url;
}

function signature(key: Uint8Array, audience: string, text: string): string {
  return createHmac('sha256', key).update(`${audience}\n${text}`).digest('hex');
}
function matches(
  key: Uint8Array,
  audience: string,
  text: string,
  actual: string | null
) {
  if (!actual || !/^[a-f0-9]{64}$/.test(actual)) return false;
  return timingSafeEqual(
    Buffer.from(signature(key, audience, text), 'hex'),
    Buffer.from(actual, 'hex')
  );
}
async function boundedText(
  body: ReadableStream<Uint8Array> | null,
  limit: number
) {
  if (!body) throw Error('INVALID_RUNNER_MESSAGE');
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void reader.cancel().catch(() => undefined);
  }, 10000);
  try {
    for (;;) {
      const part = await reader.read();
      if (timedOut) throw Error('RUNNER_MESSAGE_TIMEOUT');
      if (part.done) break;
      length += part.value.byteLength;
      if (length > limit) throw Error('RUNNER_MESSAGE_BUDGET');
      chunks.push(part.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString('utf8');
}
function validateConfig(key: Uint8Array, digest: string) {
  if (key.length < 32 || !/^[a-f0-9]{64}$/.test(digest))
    throw Error('INVALID_RUNNER_CONFIG');
}

/** Trusted control plane only. Payload is the existing public-data/source envelope;
 * caller credentials, signing keys and owner clients never enter the sandbox. */
export function createRunnerExecutor(config: {
  endpoint: string;
  key: Uint8Array;
  toolchainDigest: string;
  lane?: 'owner' | 'public-render';
  fetch?: typeof fetch;
  now?: () => number;
}) {
  const endpoint = runnerEndpoint(config.endpoint);
  const key = Uint8Array.from(config.key);
  validateConfig(key, config.toolchainDigest);
  const now = config.now ?? Date.now;
  return async (kind: QualificationKind, payload: unknown) => {
    if (config.lane === 'public-render' && kind !== 'prerender')
      throw Error('INVALID_PUBLIC_RUNNER_KIND');
    const request = experienceRunnerRequest.parse({
      version: 1,
      nonce: randomBytes(32).toString('hex'),
      // The runner accepts a 90-second future window; leave 30 seconds for skew.
      expiresAt: now() + 60000,
      toolchainDigest: config.toolchainDigest,
      lane: config.lane ?? 'owner',
      kind,
      payload,
    });
    const body = JSON.stringify(request);
    if (Buffer.byteLength(body) > INPUT_LIMIT)
      throw Error('RUNNER_MESSAGE_BUDGET');
    const response = await (config.fetch ?? fetch)(endpoint, {
      method: 'POST',
      body,
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
      signal: AbortSignal.timeout(75000),
      headers: {
        'Content-Type': 'application/json',
        'X-Baci-Runner-Signature': signature(key, 'request', body),
      },
    });
    if (response.status !== 200) {
      await response.body?.cancel();
      throw Error('RUNNER_UNAVAILABLE');
    }
    const text = await boundedText(response.body, OUTPUT_LIMIT);
    if (
      !matches(
        key,
        'response',
        text,
        response.headers.get('x-baci-runner-signature')
      )
    )
      throw Error('INVALID_RUNNER_RESPONSE');
    const result = experienceRunnerReply(request.nonce).parse(JSON.parse(text));
    return experienceRunnerExecution.parse(result.output);
  };
}

/** Ingress adapter: the injected executor MUST enforce the existing offline OCI
 * policy. No default executor, shell command, path or image is accepted over HTTP.
 * Single process replay ledger; replicas require independent keys or shared ledger. */
export function createRunnerHandler(config: {
  key: Uint8Array;
  toolchainDigest: string;
  execute: (kind: QualificationKind, payload: unknown) => Promise<unknown>;
  now?: () => number;
}) {
  const key = Uint8Array.from(config.key);
  validateConfig(key, config.toolchainDigest);
  const now = config.now ?? Date.now;
  const consumed = new Map<string, { expiry: number; lane: string }>();
  const laneCounts = new Map<string, number>();
  let active = 0;
  let publicActive = 0;
  let readers = 0;
  return async (request: Request): Promise<Response> => {
    const headers = {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json',
      'X-Content-Type-Options': 'nosniff',
    };
    if (
      request.method !== 'POST' ||
      new URL(request.url).pathname !== '/v1/execute'
    )
      return new Response('{}', { status: 404, headers });
    if (readers >= 4) return new Response('{}', { status: 429, headers });
    readers++;
    let reading = true;
    let dispatched = false;
    let publicDispatch = false;
    try {
      const text = await boundedText(request.body, INPUT_LIMIT);
      readers--;
      reading = false;
      if (
        !matches(
          key,
          'request',
          text,
          request.headers.get('x-baci-runner-signature')
        )
      )
        return new Response('{}', { status: 401, headers });
      const input = experienceRunnerRequest.parse(JSON.parse(text));
      if (input.lane === 'public-render' && input.kind !== 'prerender')
        return new Response('{}', { status: 403, headers });
      const time = now();
      for (const [nonce, entry] of consumed) {
        if (entry.expiry <= time) {
          consumed.delete(nonce);
          laneCounts.set(entry.lane, (laneCounts.get(entry.lane) ?? 1) - 1);
        }
      }
      if (
        input.expiresAt <= time ||
        input.expiresAt > time + 90000 ||
        input.toolchainDigest !== config.toolchainDigest ||
        consumed.has(input.nonce)
      )
        return new Response('{}', { status: 409, headers });
      // Reserve independent bounded replay capacity for each signed lane.
      // Never evict unexpired nonces to admit traffic: that would permit replay.
      if ((laneCounts.get(input.lane) ?? 0) >= 4096)
        return new Response('{}', { status: 429, headers });
      if (active >= 2 || (input.lane === 'public-render' && publicActive >= 1))
        return new Response('{}', { status: 429, headers });
      active++;
      dispatched = true;
      publicDispatch = input.lane === 'public-render';
      if (publicDispatch) publicActive++;
      consumed.set(input.nonce, { expiry: input.expiresAt, lane: input.lane });
      laneCounts.set(input.lane, (laneCounts.get(input.lane) ?? 0) + 1);
      const output = await config.execute(input.kind, input.payload);
      const body = JSON.stringify({ nonce: input.nonce, output });
      if (Buffer.byteLength(body) > OUTPUT_LIMIT)
        throw Error('RUNNER_MESSAGE_BUDGET');
      return new Response(body, {
        headers: {
          ...headers,
          'X-Baci-Runner-Signature': signature(key, 'response', body),
        },
      });
    } catch {
      return new Response('{}', { status: 400, headers });
    } finally {
      if (reading) readers--;
      if (dispatched) active--;
      if (publicDispatch) publicActive--;
    }
  };
}
