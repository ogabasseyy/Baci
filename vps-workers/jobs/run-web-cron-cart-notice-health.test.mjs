import assert from 'node:assert/strict';
import { it } from 'node:test';
import { runWebCron } from './run-web-cron.mjs';

const env = { BACI_WEB_BASE_URL: 'https://ogabassey.com', CRON_SECRET: 'secret' };

it('allows the shared-cart notice delivery alarm endpoint', async () => {
  const calls = [];
  const result = await runWebCron({
    path: '/api/cron/cart-notice-health',
    env,
    fetchFn: (url, init) => {
      calls.push({ url, init });
      return new Response('{"healthy":true}', { status: 200 });
    },
    logger: { log: () => undefined },
  });

  assert.deepEqual(result, { status: 200, body: '{"healthy":true}' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://ogabassey.com/api/cron/cart-notice-health');
  assert.equal(calls[0].init.method, 'GET');
});

it('fails the schedule when cart notices are not being delivered', async () => {
  await assert.rejects(
    runWebCron({
      path: '/api/cron/cart-notice-health',
      env,
      fetchFn: () => new Response('{"healthy":false}', { status: 503 }),
      logger: { log: () => undefined },
    }),
    /HTTP 503/
  );
});
