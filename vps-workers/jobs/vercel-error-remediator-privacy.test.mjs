import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { runVercelErrorRemediator } from './vercel-error-remediator.mjs';

describe('vercel remediator privacy', () => {
  it('keeps raw log body and PII out of candidates, lifecycle state, and prompts', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-vercel-private-'));
    const logPath = join(directory, 'events.jsonl');
    const pii =
      'Alice Okafor at 12 Example Road alice@example.com +2348031234567';
    const rawBody = `customer apps/Alice-Okafor-at-12-Example-Road.ts ${pii}`;
    writeFileSync(
      logPath,
      [
        JSON.stringify({
          body: rawBody,
          deploymentId: 'Alice Okafor',
          level: 'error',
          path: '/orders/Alice-Okafor-at-12-Example-Road',
          requestId: '12 Example Road',
          stack: `TypeError: invalid ${pii}`,
        }),
        JSON.stringify({
          body: rawBody,
          deploymentId: 'Alice Okafor',
          level: 'error',
          path: '/orders/Alice-Okafor-at-12-Example-Road',
          requestId: '12 Example Road',
          stack: `TypeError: invalid ${pii}`,
        }),
      ].join('\n')
    );

    const result = await runVercelErrorRemediator({
      env: {
        BACI_REMEDIATION_OUTPUT_DIR: directory,
        VERCEL_ERROR_LOG_PATH: logPath,
      },
      logger: { error: () => undefined, log: () => undefined },
    });
    const promptAction = result.actions.find((action) => action.path);
    assert.ok(promptAction);
    const prompt = readFileSync(promptAction.path, 'utf8');
    const state = readFileSync(
      join(directory, 'case-state.dry-run.json'),
      'utf8'
    );

    assert.match(prompt, /TypeError/);
    assert.match(prompt, /"route": "\/orders\/:param"/);
    assert.doesNotMatch(
      JSON.stringify(result.candidates),
      /Alice|Example Road|example\.com|234803|12-Example|apps\/Alice/
    );
    assert.doesNotMatch(
      state,
      /Alice|Example Road|example\.com|234803|12-Example/
    );
    assert.doesNotMatch(
      prompt,
      /Alice|Example Road|example\.com|234803|12-Example/
    );
  });
});
