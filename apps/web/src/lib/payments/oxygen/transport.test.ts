import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { loginOxygenPartner, OxygenTransportError } from './transport';

// Synthetic fixtures only; no real provider material.
const REFERENCE = 'syn-oxygen-ref-7f3a';
const SECRET = 'syn-oxygen-secret-9c2e';
const TOKEN = 'syn-oxygen-token-4b1d';
const BASE = 'https://login.synthetic-oxygen.test/partner-core';
const PATH_BASE = 'https://api.synthetic-oxygen.test/services/partners/';
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

describe('transport server-only marker', () => {
  it('declares the server-only marker as the first line', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/lib/payments/oxygen/transport.ts'),
      'utf8'
    );
    expect(source.split('\n')[0]).toBe("import 'server-only';");
  });
});

describe('loginOxygenPartner', () => {
  it('POSTs credentials and anchors expiry at request start', async () => {
    const fetchImpl = mockFetch(jsonResponse(200, successBody(300)));
    const now = vi.fn(() => T);

    const result = await loginOxygenPartner(
      { fetchImpl, now },
      { baseUrl: PATH_BASE, reference: REFERENCE, secret: SECRET }
    );

    expect(result).toEqual({
      token: TOKEN,
      issuedAtMs: T,
      expiresAtMs: T + 300_000,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://api.synthetic-oxygen.test/services/partners/v1/partner/login'
    );
    expect(init.method).toBe('POST');
    expect(init.body).toBe(
      JSON.stringify({ reference: REFERENCE, secret: SECRET })
    );
    expect(init.headers).toMatchObject({ Accept: 'application/json' });
    expect(init.cache).toBe('no-store');
    expect(init.redirect).toBe('error');
  });

  it('uses the first clock reading so RTT cannot extend validity', async () => {
    const fetchImpl = mockFetch(jsonResponse(200, successBody(60)));
    let calls = 0;
    const now = () => (calls++ === 0 ? T : T + 5_000);

    const result = await loginOxygenPartner({ fetchImpl, now }, INPUT);

    expect(result.issuedAtMs).toBe(T);
    expect(result.expiresAtMs).toBe(T + 60_000);
  });

  it.each([
    ['no trailing slash', 'https://login.synthetic-oxygen.test/partner-core'],
    ['one trailing slash', 'https://login.synthetic-oxygen.test/partner-core/'],
    [
      'many trailing slashes',
      'https://login.synthetic-oxygen.test/partner-core///',
    ],
  ])('joins %s without dropping the base path', async (_label, baseUrl) => {
    const fetchImpl = mockFetch(jsonResponse(200, successBody()));
    await loginOxygenPartner(
      { fetchImpl, now: () => T },
      { ...INPUT, baseUrl }
    );
    const [url] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string];
    expect(url).toBe(
      'https://login.synthetic-oxygen.test/partner-core/v1/partner/login'
    );
  });

  it.each([
    ['http scheme', 'http://login.synthetic-oxygen.test/partner-core'],
    ['uppercase scheme', 'HTTPS://login.synthetic-oxygen.test/partner-core'],
    ['leading whitespace', ' https://login.synthetic-oxygen.test/partner-core'],
    [
      'trailing whitespace',
      'https://login.synthetic-oxygen.test/partner-core ',
    ],
    ['empty baseUrl', ''],
    ['unparseable baseUrl', 'not a url'],
    ['query-bearing baseUrl', 'https://login.synthetic-oxygen.test/core?x=1'],
    [
      'fragment-bearing baseUrl',
      'https://login.synthetic-oxygen.test/core#frag',
    ],
    ['userinfo baseUrl', 'https://user:pass@login.synthetic-oxygen.test/core'],
    ['empty reference', BASE, ''],
    ['empty secret', BASE, REFERENCE, ''],
    ['null reference', BASE, null],
    ['null secret', BASE, REFERENCE, null],
  ])('rejects invalid input (%s) without calling fetch', async (...args) => {
    const [label, baseUrl, reference = REFERENCE, secret = SECRET] = args as [
      string,
      string,
      string?,
      string?,
    ];
    void label;
    const fetchImpl = mockFetch(jsonResponse(200, successBody()));

    const error = (await captureError(
      loginOxygenPartner(
        { fetchImpl, now: () => T },
        { baseUrl, reference, secret }
      )
    )) as OxygenTransportError;

    expect(error).toBeInstanceOf(OxygenTransportError);
    expect(error.code).toBe('invalid_input');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    [null],
    [undefined],
    ['not-an-object'],
    [42],
  ])('maps non-object input %s to invalid_input without throwing raw', async (input) => {
    const fetchImpl = mockFetch(jsonResponse(200, successBody()));

    const error = (await captureError(
      loginOxygenPartner(
        { fetchImpl, now: () => T },
        input as unknown as typeof INPUT
      )
    )) as OxygenTransportError;

    expect(error).toBeInstanceOf(OxygenTransportError);
    expect(error.code).toBe('invalid_input');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ['null fetchImpl', null],
    ['missing fetchImpl', undefined],
  ])('maps %s to invalid_input without calling fetch', async (_label, fetchImpl) => {
    const error = (await captureError(
      loginOxygenPartner(
        { fetchImpl, now: () => T } as unknown as {
          fetchImpl: typeof fetch;
          now: () => number;
        },
        INPUT
      )
    )) as OxygenTransportError;

    expect(error).toBeInstanceOf(OxygenTransportError);
    expect(error.code).toBe('invalid_input');
  });

  it('maps a non-function now to invalid_input without calling fetch', async () => {
    const fetchImpl = mockFetch(jsonResponse(200, successBody()));

    const error = (await captureError(
      loginOxygenPartner(
        { fetchImpl, now: 'x' } as unknown as {
          fetchImpl: typeof fetch;
          now: () => number;
        },
        INPUT
      )
    )) as OxygenTransportError;

    expect(error).toBeInstanceOf(OxygenTransportError);
    expect(error.code).toBe('invalid_input');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'auth_failed'],
    [403, 'auth_failed'],
    [429, 'upstream_error'],
    [500, 'upstream_error'],
    [302, 'upstream_error'],
  ])('maps status %i to %s with the status preserved', async (status, code) => {
    const fetchImpl = mockFetch(jsonResponse(status, { error: 'nope' }));

    const error = (await captureError(
      loginOxygenPartner({ fetchImpl, now: () => T }, INPUT)
    )) as OxygenTransportError;

    expect(error).toBeInstanceOf(OxygenTransportError);
    expect(error.code).toBe(code);
    expect(error.status).toBe(status);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('keeps a 401 body that echoes the secret out of the error', async () => {
    const fetchImpl = mockFetch(
      jsonResponse(401, { error: `bad secret ${SECRET} for ${REFERENCE}` })
    );

    const error = (await captureError(
      loginOxygenPartner({ fetchImpl, now: () => T }, INPUT)
    )) as OxygenTransportError;

    expect(error.code).toBe('auth_failed');
    expect(
      JSON.stringify({ message: error.message, status: error.status })
    ).not.toContain(SECRET);
    expect(
      JSON.stringify({ message: error.message, status: error.status })
    ).not.toContain(REFERENCE);
  });

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
