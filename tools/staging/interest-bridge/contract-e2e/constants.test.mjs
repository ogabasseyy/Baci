import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const constantsUrl = new URL('./constants.mjs', import.meta.url);
const recoveredRoot = realpathSync(
  fileURLToPath(new URL('../../../../', import.meta.url))
);

function readReceiverRoot(receiverRoot) {
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { CONTRACT_E2E } from ${JSON.stringify(constantsUrl.href)};
       process.stdout.write(JSON.stringify({root: CONTRACT_E2E.receiverRoot,
         frozen: Object.isFrozen(CONTRACT_E2E), pin: CONTRACT_E2E.runtimeStoragePin}));`,
    ],
    {
      encoding: 'utf8',
      env:
        receiverRoot === undefined
          ? {}
          : { BACI_CONTRACT_E2E_RECEIVER_ROOT: receiverRoot },
    }
  );
  return result;
}

test('retains the default receiver pointer and frozen physical guard without an override', () => {
  const result = readReceiverRoot();
  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout), {
    root: '/Users/mac/.codex/worktrees/0d77/Baci-app',
    frozen: true,
    pin: '7686901100561231906',
  });
});

test('uses the explicit existing recovered root instead of resolving dependencies in the peer', () => {
  const result = readReceiverRoot(recoveredRoot);
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).root, recoveredRoot);
});

for (const [label, candidate] of [
  ['empty', ''],
  ['relative', 'relative/source'],
  ['missing', '/nonexistent/baci-receiver-root'],
  ['file', fileURLToPath(constantsUrl)],
  ['unrelated directory', '/private/tmp'],
]) {
  test(`refuses ${label} receiver root without silently falling back`, () => {
    const result = readReceiverRoot(candidate);
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /Contract receiver source root refused/);
  });
}
