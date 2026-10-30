import {
  MUTATION_CAPABLE_MODES,
  MUTATION_PATHS,
  type MutationPath,
  type RunMode,
} from './constants';
import type { MutationGate } from './mutation-gate';
import type { ResponseCapture } from './response-capture';
import {
  assertNoRecordingAccount,
  assertTestKey,
  containsRecordingAccount,
  HarnessRefusal,
} from './safety-guards';

/**
 * The only way bytes leave this process. Installed as the global fetch for
 * the duration of a run (the existing typed client calls the global), so
 * nothing in the process can reach the network around these checks:
 *
 *   host/credentials -> path space -> recording account -> method/mode
 *   -> test key -> journaled intent (POST only) -> send (redirects off)
 *   -> recording account in response -> capture
 */

export interface GuardedFetchOptions {
  mode: RunMode;
  origin: string;
  baseFetch: typeof fetch;
  gate: MutationGate;
  capture: ResponseCapture;
  /** Minimum spacing between requests; 0 disables pacing (dry-run, tests). */
  minGapMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const NULL_BODY_STATUSES = new Set([204, 205, 304]);

function readHeader(
  headers: HeadersInit | undefined,
  name: string
): string | null {
  if (!headers) return null;
  if (headers instanceof Headers) return headers.get(name);
  const wanted = name.toLowerCase();
  const pairs = Array.isArray(headers) ? headers : Object.entries(headers);
  for (const [key, value] of pairs) {
    if (key.toLowerCase() === wanted) return String(value);
  }
  return null;
}

function requestUrl(input: RequestInfo | URL): URL {
  const raw =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  try {
    return new URL(raw);
  } catch {
    throw new HarnessRefusal(
      'HOST_NOT_ALLOWED',
      'request URL is not parseable'
    );
  }
}

export function createGuardedFetch(options: GuardedFetchOptions): typeof fetch {
  const { mode, origin, baseFetch, gate, capture } = options;
  const minGapMs = options.minGapMs ?? 0;
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let lastSentAt = Number.NEGATIVE_INFINITY;

  const preflight = (
    input: RequestInfo | URL,
    init: RequestInit | undefined
  ) => {
    const url = requestUrl(input);
    if (url.origin !== origin || url.username !== '' || url.password !== '') {
      throw new HarnessRefusal(
        'HOST_NOT_ALLOWED',
        'only the sandbox origin is reachable'
      );
    }
    if (!url.pathname.startsWith('/api/v1/')) {
      throw new HarnessRefusal('PATH_NOT_ALLOWED', 'path is outside /api/v1/');
    }
    const method = (
      init?.method ??
      (typeof input === 'object' && 'method' in input ? input.method : 'GET')
    ).toUpperCase();
    const body = typeof init?.body === 'string' ? init.body : undefined;
    assertNoRecordingAccount('request', [url.pathname, url.search, body ?? '']);

    if (method === 'POST') {
      if (!MUTATION_CAPABLE_MODES.includes(mode)) {
        throw new HarnessRefusal(
          'MUTATION_IN_READONLY',
          'read-only mode sends GET requests only'
        );
      }
      if (
        !(MUTATION_PATHS as readonly string[]).includes(
          url.pathname as MutationPath
        )
      ) {
        throw new HarnessRefusal(
          'PATH_NOT_ALLOWED',
          'POST path is not allowlisted'
        );
      }
    } else if (method !== 'GET') {
      throw new HarnessRefusal(
        'METHOD_NOT_ALLOWED',
        'only GET and allowlisted POST are permitted'
      );
    }

    const authorization = readHeader(init?.headers, 'authorization');
    assertTestKey(authorization?.replace(/^Bearer /, '') || undefined);

    if (method === 'POST') gate.authorizePost(url.pathname, body);
    return { url, method };
  };

  return async (input, init) => {
    let target: { url: URL; method: string };
    try {
      target = preflight(input, init);
    } catch (error) {
      if (error instanceof HarnessRefusal) capture.recordRefusal(error);
      throw error;
    }

    const wait = lastSentAt + minGapMs - now();
    if (minGapMs > 0 && wait > 0) await sleep(wait);
    lastSentAt = now();
    const response = await baseFetch(target.url.toString(), {
      ...init,
      redirect: 'error',
    });
    const text = await response.text();
    if (containsRecordingAccount(text)) {
      const refusal = new HarnessRefusal(
        'RECORDING_ACCOUNT',
        'response referenced a protected account and was discarded'
      );
      capture.recordRefusal(refusal);
      throw refusal;
    }

    let envelope: unknown = null;
    try {
      envelope = JSON.parse(text);
    } catch {
      envelope = null;
    }
    capture.record({
      method: target.method,
      pathname: target.url.pathname,
      httpStatus: response.status,
      envelope,
    });
    return new Response(NULL_BODY_STATUSES.has(response.status) ? null : text, {
      status: response.status,
      statusText: response.statusText,
      headers: {
        'content-type':
          response.headers.get('content-type') ?? 'application/json',
      },
    });
  };
}
