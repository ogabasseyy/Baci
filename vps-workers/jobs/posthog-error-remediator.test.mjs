import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { runPostHogErrorRemediator } from './posthog-error-remediator.mjs';

const silentLogger = {
  error: () => undefined,
  log: () => undefined,
  warn: () => undefined,
};

describe('PostHog error remediator', () => {
  it('writes and deduplicates a repeated active PostHog error-tracking issue', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'posthog-remediator-'));
    const env = {
      BACI_POSTHOG_REMEDIATION_OUTPUT_DIR: directory,
      POSTHOG_REMEDIATION_HOST: 'https://eu.posthog.com',
      POSTHOG_REMEDIATION_PERSONAL_API_KEY: 'phx_read_only_personal_key',
      POSTHOG_REMEDIATION_PROJECT_ID: '202711',
      BACI_POSTHOG_REMEDIATION_ENABLED: '1',
    };
    const fetchFn = async (url) => {
      if (String(url).endsWith('/error_tracking/query/issue/')) {
        return new Response(
          JSON.stringify({
            latest_release: { version: '2026.10.1' },
            top_in_app_frame: {
              function: 'handleCheckout',
              line: 42,
              source: 'apps/web/checkout.py',
            },
          })
        );
      }
      return new Response(
        JSON.stringify({
          hasMore: false,
          limit: 100,
          offset: 0,
          results: [
            {
              id: 'posthog-issue-1',
              status: 'active',
              aggregations: { occurrences: 2 },
            },
          ],
        })
      );
    };

    const first = await runPostHogErrorRemediator({
      env,
      fetchFn,
      logger: silentLogger,
    });
    const second = await runPostHogErrorRemediator({
      env,
      fetchFn,
      logger: silentLogger,
    });

    assert.equal(first.candidates.length, 1);
    assert.equal(first.candidates[0].source, 'posthog');
    assert.equal(first.candidates[0].category, 'posthog_issue');
    assert.match(first.candidates[0].caseKey, /^posthog:posthog_issue:/);
    assert.equal(first.candidates[0].sample.route, 'apps/web/checkout.py:42');
    assert.equal(first.candidates[0].sample.release, '2026.10.1');
    assert.equal(first.actions[0].type, 'prompt_written');
    assert.equal(second.candidates.length, 0);
    assert.deepEqual(
      second.actions.map((action) => action.type),
      ['email_skipped']
    );
  });

  it('short-circuits without side effects when the worker is disabled', async () => {
    const result = await runPostHogErrorRemediator({
      env: {
        BACI_POSTHOG_REMEDIATION_OUTPUT_DIR: mkdtempSync(
          join(tmpdir(), 'posthog-remediator-')
        ),
        POSTHOG_REMEDIATION_HOST: 'https://eu.posthog.com',
        POSTHOG_REMEDIATION_PERSONAL_API_KEY: 'phx_read_only_personal_key',
        POSTHOG_REMEDIATION_PROJECT_ID: '202711',
      },
      fetchFn: () => {
        throw new Error('fetch must not run while disabled');
      },
      logger: silentLogger,
    });

    assert.equal(result.skipped, true);
    assert.equal(result.mode, 'disabled');
    assert.deepEqual(result.actions, []);
    assert.deepEqual(result.candidates, []);
  });

  it('rejects a public PostHog ingestion key before making a request', async () => {
    await assert.rejects(
      runPostHogErrorRemediator({
        env: {
          BACI_POSTHOG_REMEDIATION_OUTPUT_DIR: mkdtempSync(
            join(tmpdir(), 'posthog-remediator-')
          ),
          POSTHOG_REMEDIATION_HOST: 'https://eu.posthog.com',
          POSTHOG_REMEDIATION_PERSONAL_API_KEY: 'phc_public_ingestion_key',
          POSTHOG_REMEDIATION_PROJECT_ID: '202711',
          BACI_POSTHOG_REMEDIATION_ENABLED: '1',
        },
        fetchFn: () => {
          throw new Error('fetch must not run with an ingestion key');
        },
        logger: silentLogger,
      }),
      /personal API key.*not a project ingestion key/i
    );
  });

  it('stays dormant without the explicit PostHog remediation feature gate', async () => {
    const result = await runPostHogErrorRemediator({
      env: {
        BACI_POSTHOG_REMEDIATION_OUTPUT_DIR: mkdtempSync(
          join(tmpdir(), 'posthog-remediator-')
        ),
      },
      fetchFn: () => {
        throw new Error('fetch must not run while PostHog remediation is disabled');
      },
      logger: silentLogger,
    });

    assert.deepEqual(result.candidates, []);
  });
});
