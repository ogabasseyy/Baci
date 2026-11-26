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

test('preserves the declared MIME type and nosniff for scripts and styles', async (t) => {
  for (const [file, mime] of [
    ['app.js', 'application/javascript'],
    ['app.css', 'text/css'],
  ]) {
    const fetch = t.mock.method(
      globalThis,
      'fetch',
      async () =>
        new Response('synthetic output', {
          headers: {
            'Content-Type': mime,
            'X-Content-Type-Options': 'nosniff',
          },
        })
    );
    const response = await worker.fetch(
      request(`/resource/${ticket}/${file}`),
      env
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Type'), mime);
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
    fetch.mock.restore();
  }
});

test('forwards a canonical route parameter only for a published document', async (t) => {
  const fetch = t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response('upstream diagnostic', {
        status: 404,
        headers: { 'X-Baci-Output-Digest': digest },
      })
  );
  const document = `/published/example-store/${digest}/index.html`;
  const path = `${document}?path=%2Fproducts%2F%5Bsample%5D`;
  const result = await worker.fetch(
    request(`${document}?path=%2fproducts%2f%5bsample%5d`),
    env
  );
  assert.equal(result.status, 404);
  assert.equal(String(fetch.mock.calls[0].arguments[0]), upstreamOrigin + path);
  assert.equal(result.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(result.headers.get('X-Baci-Output-Digest'), null);
  assert.equal(await result.text(), '');
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
    request(`${published}/index.html?path=`),
    request(`${published}/index.html?path=%2F..%2Fprivate`),
    request(`${published}/index.html?path=%2F%2Fforeign.test`),
    request(`${published}/index.html?path=%2Fencoded%252Fseparator`),
    request(`${published}/index.html?path=%2F${'a'.repeat(1024)}`),
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

test('distinguishes upstream capacity from auth denials without forwarding details', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', () => {
    throw Error('unexpected request');
  });
  for (const [status, expected] of [
    [401, 502],
    [403, 502],
    [429, 503],
    [503, 503],
  ]) {
    fetch.mock.mockImplementationOnce(
      async () =>
        new Response('synthetic origin detail', {
          status,
          headers: { 'WWW-Authenticate': 'Bearer', 'Retry-After': '10' },
        })
    );
    const result = await worker.fetch(
      request(`/resource/${ticket}/app.js`),
      env
    );
    assert.equal(result.status, expected);
    assert.equal(await result.text(), '');
    assert.equal(result.headers.get('WWW-Authenticate'), null);
    assert.equal(result.headers.get('Retry-After'), null);
  }
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
    request(`/published/example/${digest}/app.js`, {
      headers: { Origin: 'https://foreign.test' },
    }),
    env
  );
  assert.equal(
    fetch.mock.calls.at(-1).arguments[1].headers.get('Origin'),
    null
  );
  assert.equal(publicAsset.headers.get('Access-Control-Allow-Origin'), '*');
});

test('serves private and published documents only with the expected opaque sandbox policy', async (t) => {
  const contentSecurityPolicy = "default-src 'none'; sandbox allow-scripts";
  const fetch = t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response('synthetic HTML', {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Security-Policy': contentSecurityPolicy,
        },
      })
  );
  for (const path of [
    `/resource/${ticket}/index.html`,
    `/published/example/${digest}/index.html?path=%2Fsample`,
  ]) {
    const accepted = await worker.fetch(request(path), env);
    assert.equal(accepted.status, 200);
    assert.equal(
      accepted.headers.get('Content-Security-Policy'),
      contentSecurityPolicy
    );
    assert.equal(await accepted.text(), 'synthetic HTML');
    for (const policy of [
      "default-src 'none'",
      'sandbox allow-scripts allow-same-origin',
      'sandbox allow-scripts; sandbox allow-scripts',
    ]) {
      fetch.mock.mockImplementationOnce(
        async () =>
          new Response('synthetic HTML', {
            headers: {
              'Content-Type': 'text/html',
              'Content-Security-Policy': policy,
            },
          })
      );
      const denied = await worker.fetch(request(path), env);
      assert.equal(denied.status, 502);
      assert.equal(await denied.text(), '');
    }
  }
});
