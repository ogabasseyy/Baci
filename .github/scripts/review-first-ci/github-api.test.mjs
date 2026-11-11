import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createGithubClient } from './github-api.mjs';

function fakeFetch(handler) {
  const calls = [];
  const impl = async (url, options = {}) => {
    calls.push({ url, options });
    const { status = 200, body = {} } = await handler(url, options, calls.length);
    return { ok: status >= 200 && status < 300, status, text: async () => (body === null ? '' : JSON.stringify(body)) };
  };
  impl.calls = calls;
  return impl;
}

const client = (fetchImpl, extra = {}) => createGithubClient({ token: 'tok', fetchImpl, sleep: async () => {}, ...extra });

describe('createGithubClient', () => {
  it('sends the token and API version headers and parses JSON', async () => {
    const fetchImpl = fakeFetch(() => ({ body: { ok: true } }));
    assert.deepEqual(await client(fetchImpl).get('/repos/o/r/pulls/1'), { ok: true });
    const { url, options } = fetchImpl.calls[0];
    assert.equal(url, 'https://api.github.com/repos/o/r/pulls/1');
    assert.equal(options.headers.authorization, 'Bearer tok');
    assert.equal(options.headers['x-github-api-version'], '2022-11-28');
  });

  it('honours a custom API url', async () => {
    const fetchImpl = fakeFetch(() => ({ body: {} }));
    await client(fetchImpl, { apiUrl: 'https://ghe.example/api/v3' }).get('/x');
    assert.equal(fetchImpl.calls[0].url, 'https://ghe.example/api/v3/x');
  });

  it('throws an error naming the status and path on a client error, without retrying', async () => {
    const fetchImpl = fakeFetch(() => ({ status: 404, body: { message: 'Not Found' } }));
    await assert.rejects(client(fetchImpl).get('/missing'), /HTTP 404 for \/missing/);
    assert.equal(fetchImpl.calls.length, 1);
  });

  it('retries a server error once', async () => {
    const fetchImpl = fakeFetch((_url, _options, attempt) => (attempt === 1 ? { status: 502, body: {} } : { body: { ok: 1 } }));
    assert.deepEqual(await client(fetchImpl).get('/flaky'), { ok: 1 });
    assert.equal(fetchImpl.calls.length, 2);
  });

  it('gives up after the retry', async () => {
    const fetchImpl = fakeFetch(() => ({ status: 503, body: {} }));
    await assert.rejects(client(fetchImpl).get('/down'), /HTTP 503/);
    assert.equal(fetchImpl.calls.length, 2);
  });

  it('paginates arrays until a short page', async () => {
    const page = (count) => Array.from({ length: count }, (_, index) => index);
    const fetchImpl = fakeFetch((url) => ({ body: url.endsWith('page=1') ? page(100) : page(3) }));
    const all = await client(fetchImpl).paginate('/list');
    assert.equal(all.length, 103);
    assert.match(fetchImpl.calls[0].url, /\/list\?per_page=100&page=1$/);
  });

  it('appends pagination to a path that already has a query string', async () => {
    const fetchImpl = fakeFetch(() => ({ body: [] }));
    await client(fetchImpl).paginate('/list?event=pull_request');
    assert.match(fetchImpl.calls[0].url, /\/list\?event=pull_request&per_page=100&page=1$/);
  });

  it('reads a wrapped list when asked for a key', async () => {
    const fetchImpl = fakeFetch(() => ({ body: { total_count: 1, workflow_runs: [{ id: 1 }] } }));
    assert.deepEqual(await client(fetchImpl).paginate('/runs', 'workflow_runs'), [{ id: 1 }]);
  });

  it('posts a JSON body and tolerates an empty response', async () => {
    const fetchImpl = fakeFetch(() => ({ status: 201, body: null }));
    assert.deepEqual(await client(fetchImpl).post('/rerun', { a: 1 }), {});
    assert.equal(fetchImpl.calls[0].options.method, 'POST');
    assert.equal(fetchImpl.calls[0].options.body, '{"a":1}');
  });

  it('refuses to be built without a token', () => {
    assert.throws(() => createGithubClient({ token: '' }), /token/);
  });
});
