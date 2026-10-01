import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { runVercelErrorRemediator } from './vercel-error-remediator.test-harness.mjs';

const silentLogger = {
  error: () => undefined,
  log: () => undefined,
  warn: () => undefined,
};

describe('vercel error remediator resilience', () => {
  it('checkpoints each completed candidate before a later candidate aborts the run', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-remediator-'));
    const logPath = join(directory, 'vercel.jsonl');
    const outputDir = join(directory, 'out');
    writeFileSync(
      logPath,
      [
        JSON.stringify({
          level: 'error',
          message: 'Error: first',
          route: '/a',
        }),
        JSON.stringify({
          level: 'error',
          message: 'Error: first',
          route: '/a',
        }),
        JSON.stringify({
          level: 'error',
          message: 'Error: second',
          route: '/b',
        }),
        JSON.stringify({
          level: 'error',
          message: 'Error: second',
          route: '/b',
        }),
      ].join('\n')
    );
    let calls = 0;

    await assert.rejects(
      runVercelErrorRemediator({
        autofixRunner() {
          calls += 1;
          if (calls === 1) return { type: 'no_changes' };
          throw new Error('codex failed');
        },
        env: {
          BACI_REMEDIATION_AUTOFIX_ENABLED: '1',
          BACI_REMEDIATION_MAX_CANDIDATES_PER_RUN: '2',
          BACI_REMEDIATION_OUTPUT_DIR: outputDir,
          VERCEL_ERROR_LOG_PATH: logPath,
        },
        logger: {
          ...silentLogger,
          error() {
            throw new Error('worker interrupted');
          },
        },
      }),
      /worker interrupted/
    );

    calls = 0;
    const retry = await runVercelErrorRemediator({
      autofixRunner() {
        calls += 1;
        return { type: 'no_changes' };
      },
      env: {
        BACI_REMEDIATION_AUTOFIX_ENABLED: '1',
        BACI_REMEDIATION_OUTPUT_DIR: outputDir,
        VERCEL_ERROR_LOG_PATH: logPath,
      },
      logger: silentLogger,
    });

    assert.equal(retry.candidates.length, 0);
    assert.equal(calls, 0);
    const state = JSON.parse(
      readFileSync(join(outputDir, 'handled-state.autofix.json'), 'utf8')
    );
    assert.equal(Object.keys(state.handled).length, 1);
    assert.equal(Object.keys(state.reservations).length, 1);
  });

  it('reports email failures without failing the worker', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-remediator-'));
    const logPath = join(directory, 'vercel.jsonl');
    const providerEmail = 'customer@example.test';
    const providerToken = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
    writeFileSync(
      logPath,
      [
        JSON.stringify({
          level: 'error',
          message: 'Error: email',
          route: '/a',
        }),
        JSON.stringify({
          level: 'error',
          message: 'Error: email',
          route: '/a',
        }),
      ].join('\n')
    );

    const result = await runVercelErrorRemediator({
      env: {
        VERCEL_ERROR_LOG_PATH: logPath,
        BACI_REMEDIATION_OUTPUT_DIR: join(directory, 'out'),
        BACI_REMEDIATION_NOTIFY_EMAILS: 'ops@example.com',
        ZEPTOMAIL_TOKEN: 'token',
      },
      logger: silentLogger,
      fetchFn: () =>
        new Response(`recipient=${providerEmail}; token=${providerToken}`, {
          status: 503,
        }),
    });

    assert.deepEqual(result.email, {
      error: 'ZeptoMail report failed with HTTP 503',
      skipped: true,
    });
    assert.equal(
      result.actions.some((action) => action.type === 'email_failed'),
      true
    );
    assert.match(result.report.text, /email_failed/);
    const serializedJobStdout = JSON.stringify({
      actions: result.actions,
      candidates: result.candidates.length,
      email: result.email,
      mode: result.mode,
    });
    assert.doesNotMatch(serializedJobStdout, new RegExp(providerEmail));
    assert.doesNotMatch(serializedJobStdout, new RegExp(providerToken));
    assert.doesNotMatch(result.report.text, new RegExp(providerEmail));
    assert.doesNotMatch(result.report.text, new RegExp(providerToken));
  });
});
