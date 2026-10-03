import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { categoryGuidanceCases } from './category-guidance-cases';
import observedFailure from './camera-category-observed-failure.json';

const directory = mkdtempSync(join(tmpdir(), 'category-guidance-cli-'));
afterAll(() => rmSync(directory, { recursive: true, force: true }));
const runner = resolve(dirname(fileURLToPath(import.meta.url)), 'run-category-guidance-eval.ts');
function runTrace(contents: unknown) {
  const path = join(directory, 'trace.json');
  writeFileSync(path, JSON.stringify(contents));
  return spawnSync(process.execPath, ['--import', 'tsx', runner, 'camera', path], { encoding: 'utf8' });
}

describe('category guidance CLI evidence format', () => {
  it('exits zero and emits a passing result for valid synthetic first-call evidence', () => {
    // Synthetic CLI control, not a real model/browser capture.
    const traces = [{ result: { type: 'string', value: JSON.stringify({
      toolInput: { intent: { alternatives: [{ product_type: 'security_camera', brands: ['Xiaomi'], model: 'C300' }] } },
      toolOutput: { status: 'success', products: [{ id: categoryGuidanceCases.camera.productId }] },
    }) } }];
    for (const contents of [traces, { traces }]) {
      const result = runTrace(contents);
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({ caseId: 'camera', passed: true, failures: [] });
      expect(result.stderr).toBe('');
    }
  });
  it('grades actual observed evidence identically in bare and wrapped formats', () => {
    const bare = runTrace(observedFailure.traces);
    const wrapped = runTrace(observedFailure);
    expect(bare.status).toBe(1);
    expect(wrapped.status).toBe(1);
    expect(JSON.parse(wrapped.stdout).failures).toEqual(JSON.parse(bare.stdout).failures);
    expect(wrapped.stderr).toBe('');
  });
  it('explains an invalid trace wrapper without claiming missing call evidence', () => {
    const invalid = runTrace({ unexpected: [] });
    expect(invalid.status).toBe(1);
    expect(invalid.stderr).toContain('expected a native CDP trace array or an object with a traces array');
    expect(invalid.stderr).not.toContain('Missing first-call');
  });
});
