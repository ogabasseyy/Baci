import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from 'node:test';
import { writeRemediationPrompt } from './remediation-prompt-file.mjs';

it('writes prompts under their canonical case identities with private permissions', (t) => {
  const outputDir = mkdtempSync(join(tmpdir(), 'baci-prompt-file-'));
  t.after(() => rmSync(outputDir, { force: true, recursive: true }));
  chmodSync(outputDir, 0o755);
  const runtimePath = writeRemediationPrompt({
    candidate: {
      category: 'vercel_runtime_exception',
      fingerprint: 'shared',
      sample: { source: 'vercel' },
      source: 'vercel',
    },
    outputDir,
  });
  const timeoutPath = writeRemediationPrompt({
    candidate: {
      category: 'vercel_timeout',
      fingerprint: 'shared',
      sample: { source: 'vercel' },
      source: 'vercel',
    },
    outputDir,
  });

  assert.equal(
    runtimePath,
    join(outputDir, 'vercel-vercel_runtime_exception-shared.prompt.md')
  );
  assert.equal(
    timeoutPath,
    join(outputDir, 'vercel-vercel_timeout-shared.prompt.md')
  );
  assert.notEqual(runtimePath, timeoutPath);
  assert.equal(existsSync(runtimePath), true);
  assert.equal(existsSync(timeoutPath), true);
  assert.equal(statSync(outputDir).mode & 0o777, 0o700);
  assert.equal(statSync(runtimePath).mode & 0o777, 0o600);
  assert.equal(statSync(timeoutPath).mode & 0o777, 0o600);
});
