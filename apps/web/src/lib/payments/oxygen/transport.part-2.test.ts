import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { loginOxygenPartner, OxygenTransportError } from './transport';

// Synthetic fixtures only; no real provider material.
const REFERENCE = 'syn-oxygen-ref-7f3a';
const SECRET = 'syn-oxygen-secret-9c2e';
const TOKEN = 'syn-oxygen-token-4b1d';
const BASE = 'https://login.synthetic-oxygen.test/partner-core';

const T = 1_786_000_000_000;

const INPUT = { baseUrl: BASE, reference: REFERENCE, secret: SECRET };

function successBody(expires_in = 300, extra: Record<string, unknown> = {}) {
  return { token: TOKEN, expires_in, ...extra };
}

function jsonResponse(status: number, body: unknown): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    status,
    text: async () => text,
    json: async () => JSON.parse(text),
  } as unknown as Response;
}

function emptyResponse(status: number): Response {
  return {
    status,
    text: async () => '',
    json: async () => {
      throw new SyntaxError('Unexpected end of JSON input');
    },
  } as unknown as Response;
}

function mockFetch(response: unknown) {
  return vi.fn(async () => response) as unknown as typeof fetch;
}

function abortRejectingFetch() {
  return vi.fn(
    (_url: unknown, init?: { signal?: AbortSignal }) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        const onAbort = () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        };
        if (signal?.aborted) {
          onAbort();
          return;
        }
        signal?.addEventListener('abort', onAbort, { once: true });
      })
  ) as unknown as typeof fetch;
}

async function captureError(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected promise to reject');
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('loginOxygenPartner', () => {
  it.each([
    ['204 empty', emptyResponse(204)],
    ['200 empty body', emptyResponse(200)],
    ['200 non-JSON body', jsonResponse(200, 'not-json{{{')],
    ['missing token', jsonResponse(200, { expires_in: 300 })],
    ['empty token', jsonResponse(200, { token: '', expires_in: 300 })],
    ['zero expires_in', jsonResponse(200, successBody(0))],
    ['fractional expires_in', jsonResponse(200, successBody(1.5))],
    ['huge expires_in', jsonResponse(200, successBody(1_000_000))],
  ])('maps %s to invalid_response', async (_label, response) => {
    const fetchImpl = mockFetch(response);

    const error = (await captureError(
      loginOxygenPartner({ fetchImpl, now: () => T }, INPUT)
    )) as OxygenTransportError;

    expect(error.code).toBe('invalid_response');
  });

  it('ignores extra amount-ish fields without surfacing money', async () => {
    const fetchImpl = mockFetch(
      jsonResponse(200, successBody(300, { eligible_amount: 50_000 }))
    );

    const result = await loginOxygenPartner({ fetchImpl, now: () => T }, INPUT);

    expect(result).toEqual({
      token: TOKEN,
      issuedAtMs: T,
      expiresAtMs: T + 300_000,
    });
    expect(result).not.toHaveProperty('eligible_amount');
  });

  it('maps a fetch TypeError to network_error with one attempt', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;

    const error = (await captureError(
      loginOxygenPartner({ fetchImpl, now: () => T }, INPUT)
    )) as OxygenTransportError;

    expect(error.code).toBe('network_error');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('maps a genuine AbortError rejection to timeout', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new DOMException('The operation was aborted.', 'AbortError');
    }) as unknown as typeof fetch;

    const error = (await captureError(
      loginOxygenPartner({ fetchImpl, now: () => T }, INPUT)
    )) as OxygenTransportError;

    expect(error).toBeInstanceOf(OxygenTransportError);
    expect(error.code).toBe('timeout');
  });

  it('aborts at the configured timeoutMs', async () => {
    vi.useFakeTimers();
    const fetchImpl = abortRejectingFetch();

    const pending = loginOxygenPartner(
      { fetchImpl, now: () => T, timeoutMs: 5_000 },
      INPUT
    );
    const assertion = expect(pending).rejects.toMatchObject({
      code: 'timeout',
    });
    await vi.advanceTimersByTimeAsync(5_000);
    await assertion;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('times out a body read that stalls after headers resolve', async () => {
    vi.useFakeTimers();
    const bodyGate = new Promise<string>(() => undefined);
    const fetchImpl = vi.fn(async () => ({
      status: 200,
      text: () => bodyGate,
    })) as unknown as typeof fetch;

    const pending = loginOxygenPartner(
      { fetchImpl, now: () => T, timeoutMs: 1_000 },
      INPUT
    );
    const outcome: unknown[] = [];
    pending.then(
      (value) => outcome.push(value),
      (reason) => outcome.push(reason)
    );
    await vi.advanceTimersByTimeAsync(1_000);

    expect(outcome).toHaveLength(1);
    expect((outcome[0] as OxygenTransportError).code).toBe('timeout');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('maps a genuine AbortError from the body read to timeout', async () => {
    const fetchImpl = vi.fn(async () => ({
      status: 200,
      text: async () => {
        throw new DOMException('The operation was aborted.', 'AbortError');
      },
    })) as unknown as typeof fetch;

    const error = (await captureError(
      loginOxygenPartner({ fetchImpl, now: () => T }, INPUT)
    )) as OxygenTransportError;

    expect(error).toBeInstanceOf(OxygenTransportError);
    expect(error.code).toBe('timeout');
  });

  it('defaults the timeout to 30000ms and clears the timer on success', async () => {
    vi.useFakeTimers();
    const fetchImpl = mockFetch(jsonResponse(200, successBody()));

    const result = await loginOxygenPartner({ fetchImpl, now: () => T }, INPUT);

    expect(result.token).toBe(TOKEN);
    expect(vi.getTimerCount()).toBe(0);

    const hanging = loginOxygenPartner(
      { fetchImpl: abortRejectingFetch(), now: () => T },
      INPUT
    );
    let settled = false;
    hanging.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      }
    );
    await vi.advanceTimersByTimeAsync(29_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(hanging).rejects.toMatchObject({ code: 'timeout' });
  });

  it('propagates external caller cancellation as timeout', async () => {
    const controller = new AbortController();
    const fetchImpl = abortRejectingFetch();

    const pending = loginOxygenPartner(
      { fetchImpl, now: () => T, signal: controller.signal },
      INPUT
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'timeout' });
  });
});
