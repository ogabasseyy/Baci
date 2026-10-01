import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import {
  check,
  checkoutAt,
  cleanupLatchFixtures,
  fixture,
} from './check-gigl-cutover-latch.test-fixtures.mjs';

afterEach(cleanupLatchFixtures);

describe('GIGL cutover latch check', () => {
  it('reports unlatched when the smoke never succeeded', () => {
    const { origin, root, tip } = fixture();
    const checkout = checkoutAt(origin, root, 'checkout', tip);

    const { result, values } = check({ checkout });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(values.latched, 'false');
    assert.equal(values.tracking_stale, 'true');
  });

  it('reports unlatched when the latch file is corrupt', () => {
    const { origin, root, tip } = fixture();
    const checkout = checkoutAt(origin, root, 'checkout', tip);

    const { result, values } = check({ checkout, latchLiteral: 'not-a-sha' });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(values.latched, 'false');
    assert.equal(values.tracking_stale, 'true');
  });

  it('reports fresh when the latch matches HEAD', () => {
    const { origin, root, tip } = fixture();
    const checkout = checkoutAt(origin, root, 'checkout', tip);

    const { result, values } = check({ checkout, latch: tip });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(values.latched, 'true');
    assert.equal(values.tracking_stale, 'false');
  });

  it('reports stale when tracking paths changed since the latch', () => {
    const { origin, root, tip, base } = fixture();
    const checkout = checkoutAt(origin, root, 'checkout', tip);

    const { result, values } = check({ checkout, latch: base });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(values.latched, 'true');
    assert.equal(values.tracking_stale, 'true');
  });

  it('reports fresh when only untracked paths changed since the latch', () => {
    const { origin, root, tip, tracking } = fixture();
    const checkout = checkoutAt(origin, root, 'checkout', tip);

    // tip adds docs-notes.md on top of the tracking commit: no tracking
    // diff between the latch and HEAD.
    const { result, values } = check({ checkout, latch: tracking });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(values.latched, 'true');
    assert.equal(values.tracking_stale, 'false');
  });

  it('fails closed when the latched revision cannot be fetched', () => {
    const { origin, root, tip } = fixture();
    const checkout = checkoutAt(origin, root, 'checkout', tip);
    const missing = '0'.repeat(40);

    const { result, values } = check({
      checkout,
      latch: missing,
      installed: missing,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(values.latched, 'true');
    assert.equal(values.tracking_stale, 'true');
  });

  it('never passes the job token on the git command line', () => {
    const { origin, root, tip } = fixture();
    const checkout = checkoutAt(origin, root, 'checkout', tip);
    const realGit = spawnSync('/bin/sh', ['-c', 'command -v git'], {
      encoding: 'utf8',
    }).stdout.trim();
    assert.ok(realGit.length > 0, 'expected to resolve a real git binary');
    const binDir = join(root, 'shim-bin');
    const argvLog = join(root, 'git-argv.log');
    mkdirSync(binDir, { recursive: true });
    writeFileSync(argvLog, '');
    const shim = join(binDir, 'git');
    writeFileSync(
      shim,
      `#!/bin/sh\nprintf '%s\\n' "$*" >> "${argvLog}"\nexec "${realGit}" "$@"\n`
    );
    chmodSync(shim, 0o755);

    const sentinel = 'sentinel_job_token_for_argv_assertion';
    const { result, values } = check({
      checkout,
      latch: tip,
      githubToken: sentinel,
      extraPath: binDir,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(values.latched, 'true');
    assert.equal(values.tracking_stale, 'false');
    const argvLines = readFileSync(argvLog, 'utf8')
      .split('\n')
      .filter((line) => line.length > 0);
    assert.ok(
      argvLines.some((line) => line.includes('fetch')),
      `expected a fetch invocation, saw: ${argvLines.join('; ')}`
    );
    assert.ok(
      !argvLines.some((line) => line.includes(sentinel)),
      'job token must not appear in git argv'
    );
  });

  it('reports unlatched when a promote replaced the smoked worker', () => {
    const { origin, root, tip, base } = fixture();
    const checkout = checkoutAt(origin, root, 'checkout', tip);

    // Rollback/manual-promote drift: latch proves tip, installed is base.
    // The tracking diff tip..tip is empty, so only the installed-SHA
    // binding fails closed here.
    const { result, values } = check({
      checkout,
      latch: tip,
      installed: base,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(values.latched, 'false');
    assert.equal(values.tracking_stale, 'true');
  });

  it('reports unlatched when the installed SHA marker is missing', () => {
    const { origin, root, tip } = fixture();
    const checkout = checkoutAt(origin, root, 'checkout', tip);

    const { result, values } = check({
      checkout,
      latch: tip,
      installed: null,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(values.latched, 'false');
    assert.equal(values.tracking_stale, 'true');
  });

  it('reports unlatched when the installed SHA marker is corrupt', () => {
    const { origin, root, tip } = fixture();
    const checkout = checkoutAt(origin, root, 'checkout', tip);

    const { result, values } = check({
      checkout,
      latch: tip,
      installed: 'not-a-sha',
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(values.latched, 'false');
    assert.equal(values.tracking_stale, 'true');
  });

  it('emits the signal on stdout when GITHUB_OUTPUT is unset', () => {
    const { origin, root, tip } = fixture();
    const checkout = checkoutAt(origin, root, 'checkout', tip);

    const { result, values } = check({
      checkout,
      latch: tip,
      omitOutput: true,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(values.latched, 'true');
    assert.equal(values.tracking_stale, 'false');
  });

  it('rejects the pre-scoped bare-SHA latch format', () => {
    const { origin, root, tip } = fixture();
    const checkout = checkoutAt(origin, root, 'checkout', tip);

    const { result, values } = check({
      checkout,
      latchLiteral: tip,
      installed: tip,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(values.latched, 'false');
    assert.equal(values.tracking_stale, 'true');
  });

  it('rejects a latch with an unknown scope', () => {
    const { origin, root, tip } = fixture();
    const checkout = checkoutAt(origin, root, 'checkout', tip);

    const { result, values } = check({
      checkout,
      latchLiteral: `bogus:${tip}:` + '1'.repeat(64),
      installed: tip,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(values.latched, 'false');
    assert.equal(values.tracking_stale, 'true');
  });
});
