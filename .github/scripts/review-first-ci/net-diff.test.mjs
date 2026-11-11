import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildCarryOver, sameNetDiff } from './net-diff.mjs';

const PATCH = '@@ -10,3 +10,3 @@ function f() {\n   const a = 1;\n-  return a;\n+  return a + 1;\n }';
const file = (filename, sha, extra = {}) => ({ filename, sha, status: 'modified', patch: PATCH, changes: 2, ...extra });

describe('sameNetDiff', () => {
  it('is true when every touched file has the same status and blob', () => {
    assert.equal(sameNetDiff([file('a.ts', '1'), file('b.ts', '2')], [file('b.ts', '2'), file('a.ts', '1')]), true);
  });

  it('is false when a blob differs (the file changed, for example through a sync merge)', () => {
    assert.equal(sameNetDiff([file('a.ts', '1')], [file('a.ts', '9')]), false);
  });

  it('is false when the set of touched files differs', () => {
    assert.equal(sameNetDiff([file('a.ts', '1')], [file('a.ts', '1'), file('b.ts', '2')]), false);
  });

  it('is false when a status or rename differs', () => {
    assert.equal(sameNetDiff([file('a.ts', '1')], [file('a.ts', '1', { status: 'added' })]), false);
    assert.equal(sameNetDiff([file('b.ts', '1', { previous_filename: 'a.ts', status: 'renamed' })], [file('b.ts', '1', { previous_filename: 'c.ts', status: 'renamed' })]), false);
  });

  it('bugfix: the same final blob with a different base side is NOT the same diff', () => {
    // Main changed the file's base content from A to B and the sync kept the PR's version C: the
    // final blob is still C, but the reviewed change A->C became B->C (it now reverts main's edit).
    const reviewed = file('a.ts', 'C', { patch: '@@ -1 +1 @@\n-A\n+C' });
    const afterSync = file('a.ts', 'C', { patch: '@@ -1 +1 @@\n-B\n+C' });
    assert.equal(sameNetDiff([reviewed], [afterSync]), false);
  });

  it('ignores line-number shifts when the hunks themselves are identical', () => {
    const before = file('a.ts', '1', { patch: '@@ -10,3 +10,3 @@ function f() {\n x\n-y\n+z' });
    const after = file('a.ts', '1', { patch: '@@ -42,3 +45,3 @@ function f() {\n x\n-y\n+z' });
    assert.equal(sameNetDiff([before], [after]), true);
  });

  it('cannot prove a modified file that has no patch (binary or too large)', () => {
    const binary = file('logo.png', '1', { patch: undefined, changes: 0 });
    assert.equal(sameNetDiff([binary], [binary]), false);
  });

  it('can prove an added file, a removed file and a pure rename', () => {
    const added = file('new.ts', '1', { status: 'added', patch: '@@ -0,0 +1 @@\n+x', changes: 1 });
    const removed = file('old.ts', '2', { status: 'removed', patch: '@@ -1 +0,0 @@\n-x', changes: 1 });
    const renamed = file('b.ts', '3', { status: 'renamed', previous_filename: 'a.ts', patch: undefined, changes: 0 });
    assert.equal(sameNetDiff([added, removed, renamed], [added, removed, renamed]), true);
  });

  it('refuses to prove anything for an empty diff', () => {
    assert.equal(sameNetDiff([], []), false);
  });

  it('refuses to prove anything for a truncated file list', () => {
    const many = Array.from({ length: 300 }, (_, index) => file(`f${index}.ts`, String(index)));
    assert.equal(sameNetDiff(many, many), false);
  });
});

function fakeClient(responses) {
  const calls = [];
  return {
    calls,
    async get(path) {
      calls.push(path);
      if (!(path in responses)) throw new Error(`HTTP 404 for ${path}`);
      const value = responses[path];
      if (value instanceof Error) throw value;
      return value;
    },
  };
}

describe('buildCarryOver', () => {
  const base = 'main';
  const key = (from) => `/repos/o/r/compare/${base}...${from}?per_page=100`;

  it('compares the two commits against the base branch and answers true for identical diffs', async () => {
    const client = fakeClient({
      [key('aaa')]: { files: [file('a.ts', '1')] },
      [key('bbb')]: { files: [file('a.ts', '1')] },
    });
    const carryOver = buildCarryOver({ client, repository: 'o/r', base });
    assert.equal(await carryOver('aaa', 'bbb'), true);
    assert.equal(client.calls.length, 2);
  });

  it('answers false when the diffs differ', async () => {
    const client = fakeClient({
      [key('aaa')]: { files: [file('a.ts', '1')] },
      [key('bbb')]: { files: [file('a.ts', '2')] },
    });
    assert.equal(await buildCarryOver({ client, repository: 'o/r', base })('aaa', 'bbb'), false);
  });

  it('lets a failed lookup surface so the verdict fails closed', async () => {
    const client = fakeClient({ [key('bbb')]: { files: [file('a.ts', '1')] } });
    await assert.rejects(buildCarryOver({ client, repository: 'o/r', base })('aaa', 'bbb'), /404/);
  });
});
