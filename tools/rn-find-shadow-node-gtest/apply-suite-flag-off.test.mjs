import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const script = join(
  root,
  'tools/rn-find-shadow-node-gtest/apply-suite-flag-off.py',
);

const SAMPLE = `class Defaults
    : public ReactNativeFeatureFlagsDefaults {
  public:
  bool fixFindShadowNodeByTagRaceCondition() override {
    return true;
  }
};
`;

test('apply-suite-flag-off forces return false with production comment', () => {
  const dir = mkdtempSync(join(tmpdir(), 'baci-suite-flag-'));
  const file = join(dir, 'FindShadowNodeByTagTest.cpp');
  writeFileSync(file, SAMPLE);
  const first = spawnSync('python3', [script, file], { encoding: 'utf8' });
  assert.equal(first.status, 0, first.stderr || first.stdout);
  const body = readFileSync(file, 'utf8');
  assert.match(body, /Exercise the production default/);
  assert.match(body, /return false;/);
  assert.doesNotMatch(body, /return true;/);

  const second = spawnSync('python3', [script, file], { encoding: 'utf8' });
  assert.equal(second.status, 0, second.stderr || second.stdout);
  assert.equal(readFileSync(file, 'utf8'), body);
});
