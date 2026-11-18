import assert from 'node:assert/strict';
import test from 'node:test';
import worker from './worker.mjs';

const executionOrigin = 'https://baci-builder-output.ogabassey-ai.workers.dev';
const upstreamOrigin = 'https://builder-output-origin.usebaci.com';
const key = 's'.repeat(43);
const env = { EXECUTION_ORIGIN_KEY: key };
const digest = 'a'.repeat(64);
const ticket = 'b'.repeat(64);

function request(path, init) {
  return new Request(executionOrigin + path, init);
}

test('forwards private output and browser Origin without caller credentials', async (t) => {
  const csp = "default-src 'none'; frame-ancestors https://usebaci.com";
  const fetch = t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response('widget', {
        headers: {
          'Access-Control-Allow-Origin': 'null',
          'Cache-Control': 'public, max-age=300',
          'CDN-Cache-Control': 'public, max-age=300',
          'Content-Security-Policy': csp,
          'Cross-Origin-Resource-Policy': 'cross-origin',
          'Permissions-Policy': 'payment=()',
          'Referrer-Policy': 'no-referrer',
          'Set-Cookie': 'forbidden=header',
          'X-Baci-Output-Digest': digest,
          'X-Baci-Execution-Origin-Key': key,
        },
      })
  );
  const path = `/resource/${ticket}/assets/logo`;
  const input = request(path, {
    headers: {
      Origin: 'null',
      Cookie: 'user=sensitive',
      Authorization: 'Bearer sensitive',
      'X-Baci-Execution-Origin-Key': 'caller-supplied',
      'X-Forwarded-Host': 'merchant.example',
    },
  });
  const output = await worker.fetch(input, env);
  const [url, init] = fetch.mock.calls[0].arguments;
  assert.equal(String(url), upstreamOrigin + path);
  assert.equal(init.method, 'GET');
  assert.equal(init.redirect, 'manual');
  assert.equal(init.cache, 'no-store');
  assert.equal(init.signal, input.signal);
  assert.deepEqual(Object.fromEntries(init.headers), {
    origin: 'null',
    'x-baci-execution-origin-key': key,
  });
  assert.equal(output.headers.get('Content-Security-Policy'), csp);
  assert.equal(output.headers.get('Access-Control-Allow-Origin'), 'null');
  assert.equal(
    output.headers.get('Cross-Origin-Resource-Policy'),
    'cross-origin'
  );
  assert.equal(output.headers.get('Referrer-Policy'), 'no-referrer');
  assert.equal(output.headers.get('Permissions-Policy'), 'payment=()');
  assert.equal(output.headers.get('X-Baci-Output-Digest'), digest);
  assert.equal(output.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(output.headers.get('CDN-Cache-Control'), null);
  assert.equal(output.headers.get('Set-Cookie'), null);
  assert.equal(output.headers.get('X-Baci-Execution-Origin-Key'), null);
  assert.equal(await output.text(), 'widget');
});

test('forwards the original route parameter only for a published document', async (t) => {
  const fetch = t.mock.method(
    globalThis,
    'fetch',
    async () => new Response(null, { status: 404 })
  );
  const path = `/published/example-store/${digest}/index.html?path=%2Fproducts%2Fsample`;
  const result = await worker.fetch(request(path), env);
  assert.equal(result.status, 404);
  assert.equal(String(fetch.mock.calls[0].arguments[0]), upstreamOrigin + path);
  assert.equal(result.headers.get('Cache-Control'), 'private, no-store');
});

test('denies alternate hosts, routes, query shapes and methods before an upstream request', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () =>
    Response.error()
  );
  const file = `/resource/${ticket}/index.html`;
  const published = `/published/example/${digest}`;
  const invalid = [
    new Request(`https://merchant.usebaci.com${file}`),
    request(file, { method: 'HEAD' }),
    request(file, { method: 'POST' }),
    request('/api'),
    request('/internal/owner/preview'),
    request('/upstream/callback'),
    request(`${file}?path=%2F`),
    request(`/resource/${ticket}/assets/foo%2Fbar`),
    request(`/resource/${ticket}/other.js`),
    request(`${published}/app.js?path=%2F`),
    request(`${published}/index.html?path=%2F&path=%2Fx`),
    request(`${published}/index.html?target=https://example.invalid`),
  ];
  for (const input of invalid) {
    assert.equal((await worker.fetch(input, env)).status, 404);
  }
  for (const secret of [undefined, 'wrong', '*']) {
    assert.equal(
      (await worker.fetch(request(file), { EXECUTION_ORIGIN_KEY: secret }))
        .status,
      503
    );
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test('fails closed on upstream redirects and transport errors', async (t) => {
  const fetch = t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response('internal detail', {
        status: 307,
        headers: { Location: 'https://other.example/possible-secret' },
      })
  );
  const input = request(`/resource/${ticket}/app.js`);
  const redirected = await worker.fetch(input, env);
  assert.equal(redirected.status, 502);
  assert.equal(redirected.headers.get('Location'), null);
  assert.equal(await redirected.text(), '');
  fetch.mock.mockImplementationOnce(() => {
    throw Error('private upstream failure');
  });
  const failed = await worker.fetch(input, env);
  assert.equal(failed.status, 502);
  assert.equal(await failed.text(), '');
});

test('keeps private output CORS scoped to the opaque sandbox', async (t) => {
  const fetch = t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response('synthetic', {
        headers: { 'Access-Control-Allow-Origin': '*' },
      })
  );
  const file = `/resource/${ticket}/app.js`;
  const foreign = request(file, {
    headers: { Origin: 'https://foreign.test' },
  });
  assert.equal((await worker.fetch(foreign, env)).status, 404);
  assert.equal(fetch.mock.callCount(), 0);
  for (const init of [undefined, { headers: { Origin: 'null' } }]) {
    const privateOutput = await worker.fetch(request(file, init), env);
    assert.equal(privateOutput.status, 200);
    assert.equal(
      privateOutput.headers.get('Access-Control-Allow-Origin'),
      null
    );
  }
  const publicAsset = await worker.fetch(
    request(`/published/example/${digest}/app.js`),
    env
  );
  assert.equal(publicAsset.headers.get('Access-Control-Allow-Origin'), '*');
});
