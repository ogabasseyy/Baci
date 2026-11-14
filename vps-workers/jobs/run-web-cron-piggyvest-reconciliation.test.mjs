import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runWebCron } from './run-web-cron.mjs';

const noop = () => undefined;
const noopLogger = {
  debug: noop,
  error: noop,
  info: noop,
  log: noop,
  trace: noop,
  warn: noop,
};

describe('web cron worker PiggyVest reconciliation', () => {
  it('allows the PiggyVest daily reconciliation cron endpoint', async () => {
    const calls = [];
    const result = await runWebCron({
      path: '/api/cron/piggyvest-daily-reconciliation',
      env: {
        BACI_WEB_BASE_URL: 'https://ogabassey.com',
        CRON_SECRET: 'secret',
      },
      fetchFn: (url, init) => {
        calls.push({ url, init });
        return new Response('ok', { status: 200 });
      },
      logger: noopLogger,
    });

    assert.deepEqual(result, { status: 200, body: 'ok' });
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      'https://ogabassey.com/api/cron/piggyvest-daily-reconciliation'
    );
    assert.equal(calls[0].init.method, 'GET');
  });

  it('allows the early-cancel interest forfeit sweep cron endpoint', async () => {
    const calls = [];
    const result = await runWebCron({
      path: '/api/cron/piggyvest-goal-cancel-forfeit-sweep',
      env: {
        BACI_WEB_BASE_URL: 'https://ogabassey.com',
        CRON_SECRET: 'secret',
      },
      fetchFn: (url, init) => {
        calls.push({ url, init });
        return new Response('ok', { status: 200 });
      },
      logger: noopLogger,
    });

    assert.deepEqual(result, { status: 200, body: 'ok' });
    assert.equal(
      calls[0].url,
      'https://ogabassey.com/api/cron/piggyvest-goal-cancel-forfeit-sweep'
    );
  });
});
