import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  logger,
  submissionMocks as mocks,
  POST,
  request,
  setupSubmissionMocks,
} from './route.test-helpers';

describe('explicit search submissions security gates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupSubmissionMocks();
  });

  it.each([{}, { origin: 'https://evil.test' }, { origin: 'null' }] as Record<
    string,
    string
  >[])('rejects absent or untrusted origin before data access: %j', async (headers) => {
    const req = request(undefined, headers);
    if (!('origin' in headers)) req.headers.delete('origin');
    expect((await POST(req)).status).toBe(403);
    expect(mocks.merchant).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('logs origin rejections so proxy-induced shedding is observable', async () => {
    const req = request(undefined, { origin: 'https://evil.test' });
    expect((await POST(req)).status).toBe(403);
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith({
      message: 'Search submission blocked: origin mismatch',
      originHost: 'evil.test',
      requestHost: 'ogabassey.com',
    });
  });

  it('logs invalid origins without data access', async () => {
    const req = request(undefined, { origin: 'null' });
    expect((await POST(req)).status).toBe(403);
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith({
      message: 'Search submission blocked: invalid origin',
      origin: 'null',
      requestHost: 'ogabassey.com',
    });
  });

  it.each([
    'Googlebot',
    'bingbot',
    'Slackbot',
    'curl/8.0',
  ])('ignores known automated submissions from %s', async (userAgent) => {
    expect(
      (await POST(request(undefined, { 'user-agent': userAgent }))).status
    ).toBe(204);
    expect(mocks.merchant).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it.each([
    '{',
    { query: ' ', pathPrefix: '', source: 'navbar' },
    { query: 'x'.repeat(201), pathPrefix: '', source: 'navbar' },
    { query: 'phone', pathPrefix: '//evil.test', source: 'navbar' },
    { query: 'phone', pathPrefix: '', source: 'render' },
    { query: 'phone', pathPrefix: '', source: 'navbar', resultsCount: 999 },
  ])('rejects invalid input: %j', async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(mocks.merchant).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it.each([
    'Application/JSON',
    'application/json; charset=utf-8',
    ' Application/JSON ; charset=UTF-8 ',
  ])('accepts equivalent JSON media types: %s', async (contentType) => {
    expect(
      (await POST(request(undefined, { 'content-type': contentType }))).status
    ).toBe(204);
    expect(mocks.insert).toHaveBeenCalledTimes(1);
  });

  it('rejects lookalike media types at the content gate', async () => {
    expect(
      (
        await POST(
          request(undefined, { 'content-type': 'application/json-malicious' })
        )
      ).status
    ).toBe(415);
    expect(mocks.merchant).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('rejects an oversized body before parsing or data access', async () => {
    expect((await POST(request(' '.repeat(2049)))).status).toBe(413);
    expect(mocks.merchant).not.toHaveBeenCalled();
  });

  it('rejects a declared oversized body without consuming it', async () => {
    const req = request('{}', { 'content-length': '2049' });
    const read = vi.spyOn(req, 'text');
    expect((await POST(req)).status).toBe(413);
    expect(read).not.toHaveBeenCalled();
    expect(mocks.merchant).not.toHaveBeenCalled();
  });

  it('cancels a chunked oversized body as soon as the byte budget is exceeded', async () => {
    const req = request();
    const cancel = vi.fn();
    const pull = vi.fn(
      (controller: ReadableStreamDefaultController<Uint8Array>) => {
        controller.enqueue(new Uint8Array(2049));
      }
    );
    Object.defineProperty(req, 'body', {
      value: new ReadableStream({ pull, cancel }, { highWaterMark: 0 }),
    });
    expect((await POST(req)).status).toBe(413);
    expect(pull).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(mocks.merchant).not.toHaveBeenCalled();
  });
});
