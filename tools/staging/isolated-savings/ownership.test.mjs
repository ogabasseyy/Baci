import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { assertFreshOwnership } from './ownership.mjs';

test('checks all resource names and project labels including stopped containers', () => {
  const calls = [];
  assertFreshOwnership((args) => {
    calls.push(args);
    return '';
  });
  assert.equal(calls.length, 6);
  assert.ok(calls[0].includes('--all'));
  for (const resource of ['container', 'volume', 'network']) {
    assert.equal(calls.filter((args) => args[0] === resource).length, 2);
  }
});

test('rejects any preexisting named or labeled resource instead of adopting it', () => {
  for (let collision = 0; collision < 6; collision++) {
    let index = 0;
    assert.throws(
      () =>
        assertFreshOwnership(() =>
          index++ === collision ? 'existing-resource' : ''
        ),
      /Refusing preexisting/
    );
  }
});

test('inventory errors fail closed', () => {
  assert.throws(() =>
    assertFreshOwnership(() => {
      throw new Error('engine unavailable');
    })
  );
});

test('preflight rejects missing setup without invoking any Docker command', () => {
  const script = fileURLToPath(new URL('./preflight.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script, '--fresh-private'], {
    env: {},
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /preflight rejected/);
});
