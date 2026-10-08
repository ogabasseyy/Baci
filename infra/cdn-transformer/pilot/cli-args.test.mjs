import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCliArgs } from './cli-args.mjs';

test('parses --key value pairs', () => {
  assert.deepEqual(
    parseCliArgs(['--url', 'https://x/y', '--role', 'logo'], ['url', 'role']),
    {
      role: 'logo',
      url: 'https://x/y',
    }
  );
});

test('rejects unknown and duplicate flags', () => {
  // The motivating typo: --min-free-byte must abort, never silently
  // fall back to the default disk floor.
  assert.throws(
    () =>
      parseCliArgs(
        ['--inventory', 'i', '--min-free-byte', '1'],
        ['inventory'],
        ['inventory', 'min-free-bytes']
      ),
    /unknown flag "--min-free-byte"/
  );
  assert.throws(
    () => parseCliArgs(['--url', 'x', '--url', 'y'], ['url']),
    /duplicate flag "--url"/
  );
});

test('accepts allowlisted optionals beyond required keys', () => {
  assert.deepEqual(
    parseCliArgs(
      ['--inventory', 'i', '--min-free-bytes', '1024'],
      ['inventory'],
      ['inventory', 'min-free-bytes']
    ),
    { inventory: 'i', 'min-free-bytes': '1024' }
  );
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
