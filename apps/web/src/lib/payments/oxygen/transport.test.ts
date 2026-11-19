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
});
