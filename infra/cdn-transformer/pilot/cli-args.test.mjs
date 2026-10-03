import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCliArgs } from './cli-args.mjs';

test('parses --key value pairs', () => {
  assert.deepEqual(parseCliArgs(['--url', 'https://x/y', '--role', 'logo']), {
    role: 'logo',
    url: 'https://x/y',
  });
});

test('rejects unexpected arguments and missing values', () => {
  assert.throws(() => parseCliArgs(['nope']), /unexpected/);
  assert.throws(() => parseCliArgs(['--url']), /missing value/);
  assert.throws(() => parseCliArgs(['--url', '--role']), /missing value/);
});

test('enforces required keys', () => {
  assert.throws(() => parseCliArgs(['--url', 'x'], ['url', 'role']), /missing required/);
  assert.deepEqual(parseCliArgs(['--url', 'x', '--role', 'y'], ['url', 'role']), {
    role: 'y',
    url: 'x',
  });
});
