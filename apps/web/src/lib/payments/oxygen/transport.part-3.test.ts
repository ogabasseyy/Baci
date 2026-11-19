import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { loginOxygenPartner, type OxygenTransportError } from './transport';

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
  it('never leaks credentials, tokens, or bodies via errors', async () => {
    const invalidInput = (await captureError(
      loginOxygenPartner(
        {
          fetchImpl: mockFetch(jsonResponse(200, successBody())),
          now: () => T,
        },
        { ...INPUT, baseUrl: 'http://login.synthetic-oxygen.test/x' }
      )
    )) as OxygenTransportError;
    const authFailed = (await captureError(
      loginOxygenPartner(
        {
          fetchImpl: mockFetch(
            jsonResponse(401, { error: `bad ${SECRET} ${REFERENCE}` })
          ),
          now: () => T,
        },
        INPUT
      )
    )) as OxygenTransportError;
    const upstream = (await captureError(
      loginOxygenPartner(
        {
          fetchImpl: mockFetch(jsonResponse(500, { token: TOKEN })),
          now: () => T,
        },
        INPUT
      )
    )) as OxygenTransportError;
    const invalidResponse = (await captureError(
      loginOxygenPartner(
        {
          fetchImpl: mockFetch(jsonResponse(200, { token: TOKEN })),
          now: () => T,
        },
        INPUT
      )
    )) as OxygenTransportError;
    const network = (await captureError(
      loginOxygenPartner(
        {
          fetchImpl: vi.fn(async () => {
            throw new TypeError('fetch failed');
          }) as unknown as typeof fetch,
          now: () => T,
        },
        INPUT
      )
    )) as OxygenTransportError;
    const timeout = (await captureError(
      loginOxygenPartner(
        {
          fetchImpl: vi.fn(async () => {
            throw new DOMException('The operation was aborted.', 'AbortError');
          }) as unknown as typeof fetch,
          now: () => T,
        },
        INPUT
      )
    )) as OxygenTransportError;

    const errors = [
      invalidInput,
      authFailed,
      upstream,
      invalidResponse,
      network,
      timeout,
    ];
    expect(errors.map((error) => error.code)).toEqual([
      'invalid_input',
      'auth_failed',
      'upstream_error',
      'invalid_response',
      'network_error',
      'timeout',
    ]);
    for (const error of errors) {
      const serialized = JSON.stringify({
        name: error.name,
        message: error.message,
        code: error.code,
        status: error.status,
      });
      expect(serialized).not.toContain(REFERENCE);
      expect(serialized).not.toContain(SECRET);
      expect(serialized).not.toContain(TOKEN);
      expect('cause' in error).toBe(false);
    }
  });

  it('never logs across success and every failure mode', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    await loginOxygenPartner(
      { fetchImpl: mockFetch(jsonResponse(200, successBody())), now: () => T },
      INPUT
    );
    for (const response of [
      jsonResponse(401, { error: SECRET }),
      jsonResponse(500, { error: 'x' }),
      emptyResponse(200),
    ]) {
      await captureError(
        loginOxygenPartner(
          { fetchImpl: mockFetch(response), now: () => T },
          INPUT
        )
      );
    }
    await captureError(
      loginOxygenPartner(
        {
          fetchImpl: mockFetch(jsonResponse(200, successBody())),
          now: () => T,
        },
        { ...INPUT, baseUrl: 'http://x.test' }
      )
    );
    await captureError(
      loginOxygenPartner(
        {
          fetchImpl: vi.fn(async () => {
            throw new TypeError('fetch failed');
          }) as unknown as typeof fetch,
          now: () => T,
        },
        INPUT
      )
    );

    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(debugSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it('maps a redirect rejection to network_error (redirect:error rejects)', async () => {
    // With `redirect: 'error'`, a 3xx surfaces as a fetch rejection, not a
    // Response — so live redirects land here, while a synthetic 3xx Response
    // (should a transport return one) still maps to upstream_error.
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;

    const error = (await captureError(
      loginOxygenPartner({ fetchImpl, now: () => T }, INPUT)
    )) as OxygenTransportError;

    expect(error.code).toBe('network_error');
    expect(error.status).toBeUndefined();
  });
});

describe('login expiry during response delivery', () => {
  it.each([
    1_000, 2_000,
  ])('rejects a one-second token delivered after %i ms', async (elapsed) => {
    let currentTime = T;
    const fetchImpl = vi.fn(async () => {
      currentTime = T + elapsed;
      return jsonResponse(200, successBody(1));
    }) as unknown as typeof fetch;
    await expect(
      loginOxygenPartner({ fetchImpl, now: () => currentTime }, INPUT)
    ).rejects.toMatchObject({ code: 'invalid_response' });
  });
});

describe('login timeout configuration', () => {
  it.each([
    0,
    -1,
    0.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    2_147_483_648,
  ])('rejects an unsupported timer delay %s before calling the provider', async (timeoutMs) => {
    const fetchImpl = mockFetch(jsonResponse(200, successBody()));
    await expect(
      loginOxygenPartner({ fetchImpl, now: () => T, timeoutMs }, INPUT)
    ).rejects.toMatchObject({ code: 'invalid_input' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
