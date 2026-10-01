import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { runSentryMobileErrorRemediator } from './sentry-mobile-error-remediator.mjs';

const silentLogger = {
  error: () => undefined,
  log: () => undefined,
  warn: () => undefined,
};

describe('Sentry mobile error remediator', () => {
  it('writes one prompt for a repeated native issue and deduplicates it', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'sentry-remediator-'));
    const env = {
      BACI_SENTRY_REMEDIATION_OUTPUT_DIR: directory,
      SENTRY_REMEDIATION_AUTH_TOKEN: 'token',
      SENTRY_ORG: 'ogabassey',
      SENTRY_PROJECT: 'storefront',
    };
    const observedAt = new Date(Date.now() - 60_000).toISOString();
    const fetchFn = async () =>
      new Response(
        JSON.stringify([
          {
            id: 'anr-1',
            count: '2',
            title: 'Application Not Responding',
            culprit: 'MainActivity',
            lastSeen: observedAt,
          },
        ])
      );

    const first = await runSentryMobileErrorRemediator({
      env,
      fetchFn,
      logger: silentLogger,
    });
    const second = await runSentryMobileErrorRemediator({
      env,
      fetchFn,
      logger: silentLogger,
    });

    assert.equal(first.candidates.length, 1);
    assert.equal(first.actions[0].type, 'prompt_written');
    assert.equal(second.candidates.length, 0);
    assert.deepEqual(
      second.actions.map((action) => action.type),
      ['email_skipped']
    );
  });

  it('rejects when the dedicated Sentry credentials are missing', async () => {
    await assert.rejects(
      runSentryMobileErrorRemediator({
        env: {
          BACI_SENTRY_REMEDIATION_OUTPUT_DIR: mkdtempSync(
            join(tmpdir(), 'sentry-remediator-')
          ),
          SENTRY_ORG: 'ogabassey',
          SENTRY_PROJECT: 'storefront',
        },
        fetchFn: () => {
          throw new Error('fetch must not run without credentials');
        },
        logger: silentLogger,
      }),
      /SENTRY_REMEDIATION_AUTH_TOKEN/
    );
  });

  it('reports the event:read requirement when Sentry returns 403', async () => {
    await assert.rejects(
      runSentryMobileErrorRemediator({
        env: {
          BACI_SENTRY_REMEDIATION_OUTPUT_DIR: mkdtempSync(
            join(tmpdir(), 'sentry-remediator-')
          ),
          SENTRY_REMEDIATION_AUTH_TOKEN: 'token',
          SENTRY_ORG: 'ogabassey',
          SENTRY_PROJECT: 'storefront',
        },
        fetchFn: async () => new Response('forbidden', { status: 403 }),
        logger: silentLogger,
      }),
      /HTTP 403; SENTRY_REMEDIATION_AUTH_TOKEN requires event:read/
    );
  });

  it('rejects an unsafe Sentry pagination URL through the worker', async () => {
    await assert.rejects(
      runSentryMobileErrorRemediator({
        env: {
          BACI_SENTRY_REMEDIATION_OUTPUT_DIR: mkdtempSync(
            join(tmpdir(), 'sentry-remediator-')
          ),
          SENTRY_REMEDIATION_AUTH_TOKEN: 'token',
          SENTRY_ORG: 'ogabassey',
          SENTRY_PROJECT: 'storefront',
        },
        fetchFn: async () =>
          new Response('[]', {
            headers: {
              link: '<https://attacker.example/api/0/issues/>; rel="next"; results="true"',
            },
          }),
        logger: silentLogger,
      }),
      /unsafe next-page URL/
    );
  });
});
