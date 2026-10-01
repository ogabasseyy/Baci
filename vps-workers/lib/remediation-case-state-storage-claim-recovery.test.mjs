import assert from 'node:assert/strict';
import {
  linkSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { createRemediationCaseStateStorage } from './remediation-case-state-storage.mjs';

const nowMs = Date.parse('2026-08-09T10:05:00.000Z');
const staleAtMs = nowMs - 3 * 60 * 1_000;
const lockToken = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const claimToken = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const owner = (pid, token, processStartedAt) => ({
  createdAt: '2026-08-09T10:00:00.000Z',
  pid,
  ...(processStartedAt ? { processStartedAt } : {}),
  token,
});

const writeOwner = (path, value) => {
  const ownerPath = `${path}.owner-${value.token}`;
  writeFileSync(ownerPath, JSON.stringify(value));
  return ownerPath;
};

const createClaimResidue = (t, { claimContent, claimOwner, claimMtimeMs }) => {
  const directory = mkdtempSync(join(tmpdir(), 'baci-case-storage-claim-'));
  t.after(() => rmSync(directory, { force: true, recursive: true }));
  const path = join(directory, 'state.json');
  const lockPath = `${path}.lock`;
  const lockOwnerPath = writeOwner(lockPath, owner(101, lockToken));
  linkSync(lockOwnerPath, lockPath);
  const claimPath = `${lockPath}.reclaim-${lockToken}`;
  if (claimOwner) {
    const claimOwnerPath = writeOwner(lockPath, claimOwner);
    linkSync(claimOwnerPath, claimPath);
  } else {
    writeFileSync(claimPath, claimContent);
  }
  utimesSync(claimPath, claimMtimeMs / 1_000, claimMtimeMs / 1_000);
  return { claimPath, directory, path };
};

const runClaimCase = (
  t,
  {
    claimContent,
    claimMtimeMs = staleAtMs,
    claimOwner,
    processIsAlive,
    processStartedAt,
  }
) => {
  const fixture = createClaimResidue(t, {
    claimContent,
    claimMtimeMs,
    claimOwner,
  });
  let actions = 0;
  const storage = createRemediationCaseStateStorage({
    createEmptyState: () => ({ version: 1 }),
    isValidState: (state) => state?.version === 1,
    path: fixture.path,
    processIsAlive,
    processStartedAt,
  });
  const result = storage.withLock(nowMs, 'busy', () => {
    actions += 1;
    return 'recovered';
  });
  return { ...fixture, actions, result };
};

const readFileNames = (directory) => readdirSync(directory);

describe('remediation case state storage claim recovery', () => {
  it('keeps a complete live claimant busy', (t) => {
    const fixture = runClaimCase(t, {
      claimOwner: owner(202, claimToken, 'live-process'),
      processIsAlive: (pid) => pid === 202,
      processStartedAt: () => 'live-process',
    });

    assert.equal(fixture.result, 'busy');
    assert.equal(fixture.actions, 0);
    assert.equal(
      JSON.parse(readFileSync(fixture.claimPath, 'utf8')).token,
      claimToken
    );
  });

  it('reclaims a complete dead claimant with one action and no remnants', (t) => {
    const fixture = runClaimCase(t, {
      claimOwner: owner(202, claimToken),
      processIsAlive: () => false,
      processStartedAt: () => null,
    });

    assert.equal(fixture.result, 'recovered');
    assert.equal(fixture.actions, 1);
    assert.deepEqual(readFileNames(fixture.directory), []);
  });

  it('reclaims a complete PID-reused claimant with one action and no remnants', (t) => {
    const fixture = runClaimCase(t, {
      claimOwner: owner(202, claimToken, 'original-process'),
      processIsAlive: (pid) => pid === 202,
      processStartedAt: (pid) => (pid === 202 ? 'replacement-process' : null),
    });

    assert.equal(fixture.result, 'recovered');
    assert.equal(fixture.actions, 1);
    assert.deepEqual(readFileNames(fixture.directory), []);
  });

  it('keeps a recent malformed claimant busy', (t) => {
    const fixture = runClaimCase(t, {
      claimContent: '{not json',
      claimMtimeMs: nowMs,
      processIsAlive: () => false,
      processStartedAt: () => null,
    });

    assert.equal(fixture.result, 'busy');
    assert.equal(fixture.actions, 0);
    assert.equal(readFileSync(fixture.claimPath, 'utf8'), '{not json');
  });

  it('keeps a recent ownerless claimant busy', (t) => {
    const fixture = runClaimCase(t, {
      claimContent: '',
      claimMtimeMs: nowMs,
      processIsAlive: () => false,
      processStartedAt: () => null,
    });

    assert.equal(fixture.result, 'busy');
    assert.equal(fixture.actions, 0);
    assert.equal(readFileSync(fixture.claimPath, 'utf8'), '');
  });

  it('reclaims an aged malformed claimant with one action and no remnants', (t) => {
    const fixture = runClaimCase(t, {
      claimContent: '{not json',
      processIsAlive: () => false,
      processStartedAt: () => null,
    });

    assert.equal(fixture.result, 'recovered');
    assert.equal(fixture.actions, 1);
    assert.deepEqual(readFileNames(fixture.directory), []);
  });

  it('reclaims an aged ownerless claimant with one action and no remnants', (t) => {
    const fixture = runClaimCase(t, {
      claimContent: '',
      processIsAlive: () => false,
      processStartedAt: () => null,
    });

    assert.equal(fixture.result, 'recovered');
    assert.equal(fixture.actions, 1);
    assert.deepEqual(readFileNames(fixture.directory), []);
  });

  it('does not unlink a malformed claimant replaced between stable snapshots', (t) => {
    const fixture = createClaimResidue(t, {
      claimContent: '{not json',
      claimMtimeMs: staleAtMs,
    });
    const replacement = '{replacement';
    let claimStatReads = 0;
    let actions = 0;
    const storage = createRemediationCaseStateStorage({
      createEmptyState: () => ({ version: 1 }),
      isValidState: (state) => state?.version === 1,
      path: fixture.path,
      processIsAlive: () => false,
      processStartedAt: () => null,
      stat(target, options) {
        if (target === fixture.claimPath && ++claimStatReads === 2) {
          unlinkSync(fixture.claimPath);
          writeFileSync(fixture.claimPath, replacement);
        }
        return statSync(target, options);
      },
    });

    assert.equal(
      storage.withLock(nowMs, 'busy', () => {
        actions += 1;
        return 'entered';
      }),
      'busy'
    );
    assert.equal(actions, 0);
    assert.equal(readFileSync(fixture.claimPath, 'utf8'), replacement);
  });

  it('does not remove a stale third-party claim on the final retry', (t) => {
    const fixture = createClaimResidue(t, {
      claimContent: '{first claimant',
      claimMtimeMs: staleAtMs,
    });
    const replacementToken = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const replacementOwner = owner(303, replacementToken);
    const replacementOwnerPath = writeOwner(
      `${fixture.path}.lock`,
      replacementOwner
    );
    const replacementContent = JSON.stringify(replacementOwner);
    let claimRemovals = 0;
    const storage = createRemediationCaseStateStorage({
      createEmptyState: () => ({ version: 1 }),
      isValidState: (state) => state?.version === 1,
      path: fixture.path,
      processIsAlive: () => false,
      processStartedAt: () => null,
      unlink(target) {
        if (target === fixture.claimPath && claimRemovals++ === 0) {
          unlinkSync(target);
          writeFileSync(fixture.claimPath, replacementContent);
          utimesSync(fixture.claimPath, staleAtMs / 1_000, staleAtMs / 1_000);
          return;
        }
        unlinkSync(target);
      },
    });

    assert.equal(
      storage.withLock(nowMs, 'busy', () => 'entered'),
      'busy'
    );
    assert.equal(readFileSync(fixture.claimPath, 'utf8'), replacementContent);
    assert.equal(
      readFileSync(replacementOwnerPath, 'utf8'),
      replacementContent
    );
  });
});
