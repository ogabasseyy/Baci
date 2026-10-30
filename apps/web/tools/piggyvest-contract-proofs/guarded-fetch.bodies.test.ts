import { describe, expect, it } from 'vitest';
import {
  AUTH,
  build,
  ORIGIN,
  refusal,
  walletTransfer,
} from './guarded-fetch.test-support';

const transferUrl = `${ORIGIN}/api/v1/transfer/wallet`;
const jsonResponse = (headers: Record<string, string> = {}) =>
  new Response(
    JSON.stringify({ status: true, message: 'ok', data: { a: 1 } }),
    {
      status: 200,
      headers,
    }
  );

describe('guarded fetch: the body must be inspectable (fail closed)', () => {
  it('refuses a POST made through a Request object that carries a body, before any network call', async () => {
    const { guarded, baseFetch } = build('live-sandbox-mutations');
    const request = new Request(transferUrl, {
      method: 'POST',
      headers: AUTH,
      body: '{"amount":1}',
    });
    expect(await refusal(() => guarded(request))).toBe('BODY_NOT_INSPECTABLE');
    expect(baseFetch).not.toHaveBeenCalled();
  });

  it('refuses it even when a matching intent is armed, and leaves the permit unused', async () => {
    const { guarded, gate, journal, baseFetch } = build(
      'live-sandbox-mutations'
    );
    const begun = gate.begin(walletTransfer);
    if (begun.kind !== 'send') throw new Error('expected send');
    const request = new Request(transferUrl, {
      method: 'POST',
      headers: AUTH,
      body: JSON.stringify({
        ...walletTransfer.bodyMatch,
        reference: begun.reference,
      }),
    });
    expect(await refusal(() => guarded(request))).toBe('BODY_NOT_INSPECTABLE');
    gate.complete(begun.permit, 'accepted', 202);
    expect(journal.entries().at(-1)).toMatchObject({ outcome: 'not_sent' });
    expect(baseFetch).not.toHaveBeenCalled();
  });

  it.each([
    ['a Blob', () => new Blob(['{}'])],
    ['URLSearchParams', () => new URLSearchParams({ a: '1' })],
    ['FormData', () => new FormData()],
    ['an ArrayBuffer', () => new ArrayBuffer(2)],
    ['a Uint8Array', () => new Uint8Array([123, 125])],
    ['a ReadableStream', () => new ReadableStream({ start: (c) => c.close() })],
  ])('refuses a POST whose body is %s', async (_name, makeBody) => {
    const { guarded, baseFetch } = build('live-sandbox-mutations');
    expect(
      await refusal(() =>
        guarded(transferUrl, {
          method: 'POST',
          headers: AUTH,
          body: makeBody() as unknown as BodyInit,
        })
      )
    ).toBe('BODY_NOT_INSPECTABLE');
    expect(baseFetch).not.toHaveBeenCalled();
  });

  it('refuses a non-string body on any method, including a GET', async () => {
    const { guarded, baseFetch } = build('live-readonly');
    expect(
      await refusal(() =>
        guarded(`${ORIGIN}/api/v1/wallet/x`, {
          headers: AUTH,
          body: new Blob(['x']),
        })
      )
    ).toBe('BODY_NOT_INSPECTABLE');
    expect(baseFetch).not.toHaveBeenCalled();
  });

  it('still allows a body-less GET given as a Request object, and forwards its method', async () => {
    const { guarded, baseFetch } = build('live-readonly');
    await guarded(new Request(`${ORIGIN}/api/v1/wallet/x`), { headers: AUTH });
    expect(baseFetch).toHaveBeenCalledTimes(1);
    expect(baseFetch.mock.calls[0][1]).toMatchObject({ method: 'GET' });
  });
});

describe('guarded fetch: response headers reach the caller', () => {
  it('passes pagination, rate-limit and custom headers through', async () => {
    const { guarded } = build('live-readonly', () =>
      jsonResponse({
        'x-ratelimit-remaining': '7',
        'x-ratelimit-reset': '1730000000',
        link: '<https://staging.piggyvest.business/api/v1/transaction?cursor=2>; rel="next"',
        'x-custom-trace': 'abc',
        'retry-after': '3',
      })
    );
    const response = await guarded(`${ORIGIN}/api/v1/wallet/x`, {
      headers: AUTH,
    });
    expect(response.headers.get('x-ratelimit-remaining')).toBe('7');
    expect(response.headers.get('x-ratelimit-reset')).toBe('1730000000');
    expect(response.headers.get('link')).toContain('rel="next"');
    expect(response.headers.get('x-custom-trace')).toBe('abc');
    expect(response.headers.get('retry-after')).toBe('3');
  });

  it('keeps the upstream content-type and defaults to JSON only when there is none', async () => {
    const withType = build('live-readonly', () =>
      jsonResponse({ 'content-type': 'application/json; charset=utf-8' })
    );
    expect(
      (
        await withType.guarded(`${ORIGIN}/api/v1/wallet/x`, { headers: AUTH })
      ).headers.get('content-type')
    ).toBe('application/json; charset=utf-8');
    const bare = build(
      'live-readonly',
      () => new Response('{"status":true,"message":"ok"}', { status: 200 })
    );
    expect(
      (
        await bare.guarded(`${ORIGIN}/api/v1/wallet/x`, { headers: AUTH })
      ).headers.get('content-type')
    ).toMatch(/json|text\/plain/);
  });

  it('drops headers that describe the original wire encoding, which no longer applies to the rebuilt body', async () => {
    const { guarded } = build('live-readonly', () =>
      jsonResponse({
        'content-length': '9999',
        'content-encoding': 'gzip',
        'transfer-encoding': 'chunked',
      })
    );
    const response = await guarded(`${ORIGIN}/api/v1/wallet/x`, {
      headers: AUTH,
    });
    expect(response.headers.get('content-encoding')).toBeNull();
    expect(response.headers.get('transfer-encoding')).toBeNull();
    expect(response.headers.get('content-length')).not.toBe('9999');
    expect(await response.json()).toMatchObject({ status: true });
  });

  it('discards a response whose HEADERS mention the recording account', async () => {
    const { guarded, capture } = build('live-readonly', () =>
      jsonResponse({
        location: 'https://x.example/?u=baci-recording-20261013%40example.com',
      })
    );
    expect(
      await refusal(() =>
        guarded(`${ORIGIN}/api/v1/wallet/x`, { headers: AUTH })
      )
    ).toBe('RECORDING_ACCOUNT');
    expect(capture.take().response).toBeNull();
  });

  it('records no header at all, so no header value can reach the evidence', async () => {
    const { guarded, capture } = build('live-readonly', () =>
      jsonResponse({
        'x-secret-looking': '023f843a-be7e-494a-bc5d-9f49f4cc640f',
      })
    );
    await guarded(`${ORIGIN}/api/v1/wallet/x`, { headers: AUTH });
    const seen = capture.take().response;
    expect(Object.keys(seen ?? {}).sort()).toEqual([
      'envelope',
      'httpStatus',
      'method',
      'pathname',
    ]);
    expect(JSON.stringify(seen)).not.toContain('023f843a');
  });
});
