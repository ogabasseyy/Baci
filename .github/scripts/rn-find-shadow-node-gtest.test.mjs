import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const runSh = join(root, 'tools/rn-find-shadow-node-gtest/run.sh');
const cmake = join(root, 'tools/rn-find-shadow-node-gtest/CMakeLists.txt');
const bootstrap = join(root, 'tools/rn-find-shadow-node-gtest/bootstrap-native-deps.sh');
const workflow = join(root, '.github/workflows/rn-find-shadow-node-gtest.yml');
const patch = join(root, 'patches/react-native@0.86.2.patch');
const rnTest = join(
  root,
  'node_modules/react-native/ReactCommon/react/renderer/uimanager/tests/FindShadowNodeByTagTest.cpp',
);
const uiManager = join(
  root,
  'node_modules/react-native/ReactCommon/react/renderer/uimanager/UIManager.cpp',
);

test('gtest harness and workflow exist', () => {
  assert.equal(existsSync(runSh), true);
  assert.equal(existsSync(cmake), true);
  assert.equal(existsSync(bootstrap), true);
  assert.equal(existsSync(workflow), true);
  assert.equal(existsSync(patch), true);
});

test('workflow builds and executes the patched FindShadowNodeByTagTest', () => {
  const body = readFileSync(workflow, 'utf8');
  assert.match(body, /tools\/rn-find-shadow-node-gtest\/run\.sh/);
  assert.match(body, /FindShadowNodeByTagTest/);
  assert.match(body, /BACI_RN_GTEST_SANITIZER/);
  assert.match(body, /sanitizer:\s*address/);
  assert.match(body, /pnpm-install-cached/);
});

test('CMakeLists compiles the real node_modules suite path', () => {
  const body = readFileSync(cmake, 'utf8');
  assert.match(
    body,
    /uimanager\/tests\/FindShadowNodeByTagTest\.cpp/,
  );
  assert.match(body, /add_executable\(find_shadow_node_by_tag_test/);
});

test('installed react-native carries the flag-disabled ownership suite', () => {
  assert.equal(existsSync(rnTest), true, 'pnpm install must materialize react-native');
  assert.equal(existsSync(uiManager), true);
  const suite = readFileSync(rnTest, 'utf8');
  const impl = readFileSync(uiManager, 'utf8');
  assert.match(suite, /Exercise the production default/);
  assert.match(suite, /return false;/);
  assert.match(suite, /ConcurrentFindAndCommitStress/);
  assert.match(impl, /getCurrentRevision\(\)\.rootShadowNode/);
  assert.doesNotMatch(impl, /fixFindShadowNodeByTagRaceCondition\(\)/);
});

test('run.sh targets the node_modules suite and gtest filter', () => {
  const body = readFileSync(runSh, 'utf8');
  assert.match(body, /FindShadowNodeByTagTest\.cpp/);
  assert.match(body, /--gtest_filter='FindShadowNodeByTagTest\.\*'/);
  assert.match(body, /Exercise the production default/);
  assert.match(body, /getCurrentRevision\(\)\.rootShadowNode/);
});

test('bootstrap keeps RN glog config.h namespace macros (no config.h.in overwrite)', () => {
  const body = readFileSync(bootstrap, 'utf8');
  assert.match(body, /config\.h\.in/);
  assert.match(body, /_START_GOOGLE_NAMESPACE_/);
  assert.match(body, /Never process config\.h\.in/);
  assert.match(body, /src\/glog\//);
});
