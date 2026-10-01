import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { runVercelErrorRemediator as runProductionVercelErrorRemediator } from './vercel-error-remediator.mjs';
import { runVercelErrorRemediator } from './vercel-error-remediator.test-harness.mjs';

const silentLogger = {
  error: () => undefined,
  log: () => undefined,
  warn: () => undefined,
};

describe('vercel error remediator worker', () => {
  it('does not forward a caller lock validator into autofix authorization', async () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'baci-remediator-auth-'));
    let loaded = false;

    await assert.rejects(
      runProductionVercelErrorRemediator({
        candidateLoader: () => {
          loaded = true;
          return [];
        },
        env: {
          BACI_REMEDIATION_AUTOFIX_ENABLED: '1',
          BACI_REMEDIATION_OUTPUT_DIR: outputDir,
        },
        lockCapabilityValidator: () => true,
        logger: silentLogger,
        remediationLock: {},
      }),
      /global remediation flock/
    );

    assert.equal(loaded, false);
  });

  it('returns a rejected promise when required setup is missing', async () => {
    const result = runVercelErrorRemediator({
      env: {
        BACI_REMEDIATION_OUTPUT_DIR: mkdtempSync(
          join(tmpdir(), 'baci-remediator-')
        ),
      },
      logger: silentLogger,
    });

    assert.equal(typeof result?.then, 'function');
    await assert.rejects(result, /VERCEL_ERROR_LOG_PATH is required/);
  });

  it('writes prompts for repeated error candidates in dry-run mode', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-remediator-'));
    const logPath = join(directory, 'vercel.jsonl');
    const outputDir = join(directory, 'out');
    writeFileSync(
      logPath,
      [
        JSON.stringify({
          level: 'error',
          message: 'TypeError: Cannot read properties of undefined',
          route: '/api/products',
          deploymentId: 'dpl_123',
        }),
        JSON.stringify({
          level: 'error',
          message: 'TypeError: Cannot read properties of undefined',
          route: '/api/products',
          deploymentId: 'dpl_123',
        }),
      ].join('\n')
    );

    const result = await runVercelErrorRemediator({
      env: {
        VERCEL_ERROR_LOG_PATH: logPath,
        BACI_REMEDIATION_OUTPUT_DIR: outputDir,
        BACI_REMEDIATION_MIN_OCCURRENCES: '2',
      },
      logger: silentLogger,
      fetchFn: () => {
        throw new Error('email should be skipped');
      },
    });

    assert.equal(result.candidates.length, 1);
    assert.equal(result.actions[0].type, 'prompt_written');
    assert.match(readFileSync(result.actions[0].path, 'utf8'), /TypeError/);
    assert.equal(result.email.skipped, true);

    const repeated = await runVercelErrorRemediator({
      env: {
        VERCEL_ERROR_LOG_PATH: logPath,
        BACI_REMEDIATION_OUTPUT_DIR: outputDir,
        BACI_REMEDIATION_MIN_OCCURRENCES: '2',
      },
      logger: silentLogger,
    });
    assert.equal(repeated.candidates.length, 0);
    assert.deepEqual(
      repeated.actions.map((action) => action.type),
      ['email_skipped']
    );
  });

  it('does not let a dry run consume a candidate before autofix is enabled', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-remediator-'));
    const logPath = join(directory, 'vercel.jsonl');
    const outputDir = join(directory, 'out');
    writeFileSync(
      logPath,
      [
        JSON.stringify({
          level: 'error',
          message: 'Error: approved',
          route: '/a',
        }),
        JSON.stringify({
          level: 'error',
          message: 'Error: approved',
          route: '/a',
        }),
      ].join('\n')
    );
    const baseEnv = {
      VERCEL_ERROR_LOG_PATH: logPath,
      BACI_REMEDIATION_OUTPUT_DIR: outputDir,
    };
    let autofixCalls = 0;

    await runVercelErrorRemediator({ env: baseEnv, logger: silentLogger });
    const autofix = await runVercelErrorRemediator({
      autofixRunner() {
        autofixCalls += 1;
        return { type: 'no_changes' };
      },
      env: { ...baseEnv, BACI_REMEDIATION_AUTOFIX_ENABLED: '1' },
      logger: silentLogger,
    });

    assert.equal(autofix.candidates.length, 1);
    assert.equal(autofixCalls, 1);
    assert.equal(
      autofix.actions.some((action) => action.type === 'no_changes'),
      true
    );
  });

  it('does not generate work for one-off events below threshold', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-remediator-'));
    const logPath = join(directory, 'vercel.jsonl');
    writeFileSync(
      logPath,
      JSON.stringify({
        level: 'error',
        message: 'Error: one off',
        route: '/api/products',
      })
    );

    const result = await runVercelErrorRemediator({
      env: {
        VERCEL_ERROR_LOG_PATH: logPath,
        BACI_REMEDIATION_OUTPUT_DIR: join(directory, 'out'),
        BACI_REMEDIATION_MIN_OCCURRENCES: '2',
      },
      logger: silentLogger,
    });

    assert.equal(result.candidates.length, 0);
    assert.deepEqual(result.actions, []);
  });

  it('does not email no-candidate reports', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-remediator-'));
    const logPath = join(directory, 'vercel.jsonl');
    writeFileSync(logPath, '');

    const result = await runVercelErrorRemediator({
      env: {
        VERCEL_ERROR_LOG_PATH: logPath,
        BACI_REMEDIATION_NOTIFY_EMAILS: 'ops@example.com',
        ZEPTOMAIL_TOKEN: 'token',
      },
      logger: silentLogger,
      fetchFn: () => {
        throw new Error('email should not be sent');
      },
    });

    assert.equal(result.candidates.length, 0);
    assert.deepEqual(result.email, {
      reason: 'no candidates',
      skipped: true,
    });
  });

  it('continues processing candidates when one autofix fails', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-remediator-'));
    const logPath = join(directory, 'vercel.jsonl');
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

    const result = await runVercelErrorRemediator({
      env: {
        VERCEL_ERROR_LOG_PATH: logPath,
        BACI_REMEDIATION_AUTOFIX_ENABLED: '1',
        BACI_REMEDIATION_MAX_CANDIDATES_PER_RUN: '2',
        BACI_REMEDIATION_OUTPUT_DIR: join(directory, 'out'),
      },
      logger: silentLogger,
      autofixRunner() {
        calls += 1;
        if (calls === 1) {
          throw new Error('codex failed');
        }
        return {
          branch: 'codex/vercel-remediation-second',
          type: 'pr_opened',
          prUrl: 'https://github.com/ogabasseyy/Baci/pull/1',
        };
      },
    });

    assert.equal(result.candidates.length, 2);
    assert.equal(
      result.actions.some((action) => action.type === 'autofix_failed'),
      true
    );
    assert.equal(
      result.actions.some((action) => action.type === 'pr_opened'),
      true
    );
  });
});
