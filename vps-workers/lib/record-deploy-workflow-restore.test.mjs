import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  fixtureOrigin,
  recordCommits,
  recordContent,
  runRecord,
  SHA,
  tsvRows,
} from './record-deploy-workflow-promote.test-fixtures.mjs';

// Split from record-deploy-workflow-promote.test.mjs (near the
// 300-line limit): restore-phase coverage for the post-rollback
// second write. Runs that started during a stalled post-flip refresh
// read the rolled-back candidate yet are absent from the pre-flip
// record; without this write their pre-publish check would pass.

test('restore phase records the current run list with rolled-back voice', () => {
  const { bare, result } = runRecord({
    phase: 'restore',
    runIds: tsvRows('184400111', '184400112'),
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(recordContent(bare), `${SHA}:184400111,184400112`);
  assert.match(result.stdout, /Recorded restore-window overlap/);
  assert.match(result.stdout, new RegExp(`rolled-back ${SHA}`));
  assert.match(result.stdout, /affected runs refuse at publish/);
});

test('restore phase supersedes the pre-flip record with the fuller run list', () => {
  const bare = fixtureOrigin();
  const first = runRecord({
    origin: bare,
    phase: 'pre',
    runIds: tsvRows('184400111'),
  });
  assert.equal(first.result.status, 0, first.result.stderr);
  const second = runRecord({
    origin: bare,
    phase: 'restore',
    runIds: tsvRows('184400111', '184400112'),
  });

  assert.equal(second.result.status, 0, second.result.stderr);
  assert.equal(recordContent(bare), `${SHA}:184400111,184400112`);
  assert.equal(recordCommits(bare).length, 2);
});

test('restore phase fails closed with restore-window aftermath when the push fails', () => {
  const { result } = runRecord({
    phase: 'restore',
    origin: join(tmpdir(), 'baci-promote-missing-origin.git'),
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Rolled-back worker promote is NOT recorded/);
  assert.match(result.stderr, /restore-window runs are unrecorded/);
  assert.match(result.stderr, /manually confirm/);
  assert.match(result.stderr, /after 3 attempts/);
  assert.doesNotMatch(result.stderr, /Nothing was mutated/);
});

test('restore phase fails closed when the run list fails', () => {
  const { bare, result } = runRecord({
    phase: 'restore',
    scenario: 'listfail',
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Rolled-back worker promote is NOT recorded/);
  assert.match(result.stderr, /could not list workflow runs/);
  assert.throws(() => recordContent(bare));
});
