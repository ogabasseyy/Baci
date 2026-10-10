import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import test from 'node:test';

import { assertVercelApiSupport, originRepoSlug, readRuns, RUNS_MAX_PAGES } from './release-production.mjs';

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

test('paginates run listing with one bounded call per page', () => {
  const directory = mkdtempSync(join(tmpdir(), 'baci-fake-gh-'));
  const log = join(directory, 'calls.log');
  writeFileSync(
    join(directory, 'gh'),
    `#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
const endpoint = process.argv[3];
appendFileSync(${JSON.stringify(log)}, endpoint + '\\n');
const page = Number(/[?&]page=(\\d+)/.exec(endpoint)[1]);
const counts = process.env.FAKE_GH_PAGES.split(',').map(Number);
const runs = Array.from({ length: counts[page - 1] ?? 0 }, (_, i) => ({
  id: page * 1000 + i, head_sha: 'b'.repeat(40), status: 'queued',
  event: 'workflow_dispatch', display_title: 't', oversized_raw_payload: 'x'.repeat(4096),
}));
process.stdout.write(JSON.stringify({ workflow_runs: runs }));
`,
    { mode: 0o755 }
  );
  const savedPath = process.env.PATH;
  const savedPages = process.env.FAKE_GH_PAGES;
  process.env.PATH = `${directory}${delimiter}${savedPath}`;
  try {
    process.env.FAKE_GH_PAGES = '100,3';
    const runs = readRuns('status=queued', true);
    assert.equal(runs.length, 103);
    assert.deepEqual(Object.keys(runs[0]).sort(), ['databaseId', 'event', 'headSha', 'status', 'title']);
    assert.equal(runs[102].databaseId, 2002);
    const calls = readFileSync(log, 'utf8').trim().split('\n');
    assert.equal(calls.length, 2);
    assert.ok(!calls.some(call => call.includes('--paginate')));

    writeFileSync(log, '');
    process.env.FAKE_GH_PAGES = '100,100,100,100,100,100';
    assert.equal(readRuns('status=queued', true).length, RUNS_MAX_PAGES * 100);
    assert.equal(readFileSync(log, 'utf8').trim().split('\n').length, RUNS_MAX_PAGES);

    writeFileSync(log, '');
    assert.equal(readRuns('status=queued', false).length, 100);
    assert.equal(readFileSync(log, 'utf8').trim().split('\n').length, 1);
  } finally {
    process.env.PATH = savedPath;
    if (savedPages === undefined) delete process.env.FAKE_GH_PAGES;
    else process.env.FAKE_GH_PAGES = savedPages;
    rmSync(directory, { recursive: true, force: true });
  }
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
