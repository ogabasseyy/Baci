import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';
const script = resolve(import.meta.dirname, '../../tools/rn-find-shadow-node-gtest/apply-suite-flag-off.py');
function run(source) {
  const dir = mkdtempSync(resolve(tmpdir(), 'baci-rn-suite-'));
  const file = resolve(dir, 'FindShadowNodeByTagTest.cpp');
  try {
    writeFileSync(file, source);
    const result = spawnSync('python3', [script, file], { encoding: 'utf8' });
    return { ...result, source: readFileSync(file, 'utf8') };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
test('retains the upstream unconditional ownership suite without mutation', () => {
  const source = 'class FindShadowNodeByTagTest {};\nTEST_F(FindShadowNodeByTagTest, ConcurrentFindAndCommitStress) {}\n';
  const result = run(source);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.source, source);
});
test('still disables the opt-in flag in legacy suites', () => {
  const result = run('bool fixFindShadowNodeByTagRaceCondition() override {\n  return true;\n}\n');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.source, /return false;/);
});
test('fails closed for an unrecognized suite', () => {
  assert.equal(run('class UnknownSuite {};').status, 1);
});
