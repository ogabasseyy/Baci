import assert from 'node:assert/strict';
import { test } from 'vitest';
import { assertServedBuild } from './sitespeed-build-identity.mjs';

function response(html, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url: 'http://served/',
    text: async () => html,
  };
}

test('asserts an App Router escaped RSC b field without returning HTML', async () => {
  const result = await assertServedBuild(
    'http://served:3105',
    'build-app-router',
    {
      fetchImpl: (_url, init) => {
        assert.equal(init.redirect, 'follow');
        assert.ok(init.signal instanceof AbortSignal);
        return response(
          'self.__next_f.push([1,"1:{\\"b\\":\\"build-app-router\\"}"])'
        );
      },
    }
  );

  assert.deepEqual(result, {
    buildId: 'build-app-router',
    status: 200,
    url: 'http://served/',
  });
  assert.equal('html' in result, false);
});

test('asserts the current served App Router marker', async () => {
  const result = await assertServedBuild(
    'http://127.0.0.1:3105',
    '0tn-8wpTnoTHIesepUG_o',
    {
      fetchImpl: async () =>
        response(
          'self.__next_f.push([1,"1:{\\"b\\":\\"0tn-8wpTnoTHIesepUG_o\\"}"])'
        ),
    }
  );
  assert.equal(result.buildId, '0tn-8wpTnoTHIesepUG_o');
});

test('supports Pages Router __NEXT_DATA__ build IDs', async () => {
  const result = await assertServedBuild('http://served', 'build-pages', {
    fetchImpl: async () =>
      response('<script id="__NEXT_DATA__">{"buildId":"build-pages"}</script>'),
  });
  assert.equal(result.buildId, 'build-pages');
});

test('fails closed on a mismatch and non-success response', async () => {
  await assert.rejects(
    assertServedBuild('http://served', 'expected', {
      fetchImpl: async () =>
        response('<script id="__NEXT_DATA__">{"buildId":"other"}</script>'),
    }),
    /build ID mismatch/
  );
  await assert.rejects(
    assertServedBuild('http://served', 'expected', {
      fetchImpl: async () => response('', 503),
    }),
    /HTTP 503/
  );
  await assert.rejects(
    assertServedBuild('http://served', 'expected', {
      fetchImpl: async () =>
        response('<script>window.data={"b":"expected"}</script>'),
    }),
    /does not contain a Next.js build ID/
  );
  await assert.rejects(
    assertServedBuild('http://served', 'expected', {
      fetchImpl: async () =>
        response(
          '<script id="__NEXT_DATA__">{"buildId":"expected"}</script>' +
            'self.__next_f.push([1,"1:{\\"b\\":\\"other\\"}"])'
        ),
    }),
    /conflicting Next.js build IDs/
  );
});

test('bounds a hung served-build fetch', async () => {
  await assert.rejects(
    assertServedBuild('http://served', 'expected', {
      timeoutMs: 10,
      fetchImpl: (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    }),
    /timed out after 10ms/
  );
});
