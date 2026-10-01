import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { writeRemediationResultArtifact } from './remediation-result-artifact.mjs';

describe('remediation result artifact', () => {
  it('persists a private human-reviewable Codex investigation', () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'baci-remediation-result-'));

    const path = writeRemediationResultArtifact({
      candidate: {
        category: 'vercel_runtime_exception',
        fingerprint: 'candidate/../../unsafe',
        source: 'vercel',
      },
      output: 'No safe production change was identified.\n',
      outputDir,
    });

    assert.equal(
      path,
      join(
        outputDir,
        'vercel-vercel_runtime_exception-candidate-------unsafe.result.md'
      )
    );
    assert.match(readFileSync(path, 'utf8'), /No safe production change/);
    assert.equal(statSync(path).mode & 0o777, 0o600);
  });

  it('keeps results for same-fingerprint categories separate', () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'baci-remediation-result-'));
    const runtimePath = writeRemediationResultArtifact({
      candidate: {
        category: 'vercel_runtime_exception',
        fingerprint: 'shared',
        source: 'vercel',
      },
      output: 'runtime result',
      outputDir,
    });
    const timeoutPath = writeRemediationResultArtifact({
      candidate: {
        category: 'vercel_timeout',
        fingerprint: 'shared',
        source: 'vercel',
      },
      output: 'timeout result',
      outputDir,
    });

    assert.notEqual(runtimePath, timeoutPath);
    assert.match(readFileSync(runtimePath, 'utf8'), /runtime result/);
    assert.match(readFileSync(timeoutPath, 'utf8'), /timeout result/);
  });

  it('does not write outside an explicitly configured output directory', () => {
    assert.equal(
      writeRemediationResultArtifact({
        candidate: { fingerprint: 'abc123' },
        output: 'review',
      }),
      undefined
    );
  });
});
