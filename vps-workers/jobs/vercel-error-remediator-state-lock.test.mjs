import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { runVercelErrorRemediator } from './vercel-error-remediator.test-harness.mjs';

const silentLogger = {
  error: () => undefined,
  log: () => undefined,
  warn: () => undefined,
};

describe('vercel remediator state lock', () => {
  it('does not classify or rerun a successful PR when checkpointing is busy', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-remediator-lock-'));
    const logPath = join(directory, 'vercel.jsonl');
    const configuredStatePath = join(directory, 'state.json');
    const lockPath = join(directory, 'state.autofix.json.lock');
    writeFileSync(
      logPath,
      [
        JSON.stringify({ level: 'error', message: 'Error: lock', route: '/a' }),
        JSON.stringify({ level: 'error', message: 'Error: lock', route: '/a' }),
      ].join('\n')
    );
    const env = {
      BACI_REMEDIATION_AUTOFIX_ENABLED: '1',
      BACI_REMEDIATION_OUTPUT_DIR: join(directory, 'out'),
      BACI_REMEDIATION_STATE_PATH: configuredStatePath,
      VERCEL_ERROR_LOG_PATH: logPath,
    };
    let nowMs = Date.parse('2026-08-05T21:00:00Z');
    let autofixCalls = 0;
    const autofixRunner = () => {
      autofixCalls += 1;
      writeFileSync(lockPath, 'busy');
      return {
        branch: 'codex/vercel-remediation-lock-1',
        prUrl: 'https://example.test/pr/1',
        type: 'pr_opened',
      };
    };

    await assert.rejects(
      runVercelErrorRemediator({
        autofixRunner,
        env,
        logger: silentLogger,
        now: () => nowMs,
      }),
      /remediation state is busy/
    );
    unlinkSync(lockPath);
    nowMs += 16 * 60 * 1_000;

    const retry = await runVercelErrorRemediator({
      autofixRunner,
      env,
      logger: silentLogger,
      now: () => nowMs,
    });
    assert.equal(retry.candidates.length, 1);
    assert.equal(retry.candidates[0].lifecycleEvent, 'pr_recovered');
    assert.equal(retry.candidates[0].autofixEligible, false);
    assert.equal(autofixCalls, 1);
    const autofixStatePath = configuredStatePath.replace(
      /\.json$/,
      '.autofix.json'
    );
    const state = JSON.parse(readFileSync(autofixStatePath, 'utf8'));
    assert.equal(Object.keys(state.handled).length, 1);
    assert.equal(readdirSync(`${autofixStatePath}.handled-fallback`).length, 0);
  });
});
