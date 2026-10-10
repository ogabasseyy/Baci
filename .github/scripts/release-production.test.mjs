import assert from 'node:assert/strict';
import test from 'node:test';

import { assertVercelApiSupport, originRepoSlug } from './release-production.mjs';

test('accepts every canonical GitHub remote spelling', () => {
  for (const remote of [
    'https://github.com/ogabasseyy/Baci.git',
    'https://github.com/ogabasseyy/Baci',
    'git@github.com:ogabasseyy/Baci.git',
    'git@github.com:ogabasseyy/Baci',
    'ssh://git@github.com/ogabasseyy/Baci.git',
    'https://github.com/Ogabasseyy/baci.git',
  ]) {
    assert.equal(originRepoSlug(remote), 'ogabasseyy/baci');
  }
});

test('requires a Vercel CLI that provides the api subcommand', () => {
  assert.doesNotThrow(() => assertVercelApiSupport(() => {}));
  assert.throws(() => assertVercelApiSupport(() => {
    throw new Error('vercel failed');
  }), {
    message: 'operator Vercel CLI must provide `vercel api` (>= 50.5.0); upgrade vercel and retry',
  });
});

test('rejects non-GitHub and non-repository remotes', () => {
  for (const remote of [
    '',
    undefined,
    'https://gitlab.com/ogabasseyy/Baci.git',
    'git@github.com:other/other.git',
    'https://github.com.evil.example/ogabasseyy/Baci.git',
    '/local/path/checkout',
  ]) {
    assert.notEqual(originRepoSlug(remote), 'ogabasseyy/baci');
  }
});
