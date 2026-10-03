import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import observedFailure from './camera-category-observed-failure.json';

const directory = mkdtempSync(join(tmpdir(), 'category-guidance-cli-'));
afterAll(() => rmSync(directory, { recursive: true, force: true }));
const runner = resolve('mcp-server/evals/run-category-guidance-eval.ts');
function runTrace(contents: unknown) {
  const path = join(directory, 'trace.json');
  writeFileSync(path, JSON.stringify(contents));
  return spawnSync(process.execPath, ['--import', 'tsx', runner, 'camera', path], { encoding: 'utf8' });
}

describe('category guidance CLI evidence format', () => {
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
