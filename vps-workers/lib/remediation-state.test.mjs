import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { createRemediationState } from './remediation-state.mjs';

const candidate = {
  fingerprint: 'issue-1',
  lastSeen: '2026-08-04T15:46:50Z',
  occurrences: 2,
};

describe('remediation state', () => {
  it('suppresses an observation after it has been handled', () => {
    const directory = mkdtempSync(join(tmpdir(), 'remediation-state-'));
    const path = join(directory, 'handled.json');
    const state = createRemediationState({ path });

    assert.deepEqual(state.pending([candidate]), [candidate]);
    state.mark([candidate]);

    const reloaded = createRemediationState({ path });
    assert.deepEqual(reloaded.pending([candidate]), []);
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).version, 2);
  });

  it('allows the same fingerprint when a newer observation arrives', () => {
    const directory = mkdtempSync(join(tmpdir(), 'remediation-state-'));
    const path = join(directory, 'handled.json');
    const state = createRemediationState({ path });
    state.mark([candidate]);

    const newer = { ...candidate, lastSeen: '2026-08-04T16:00:00Z' };
    assert.deepEqual(createRemediationState({ path }).pending([newer]), [
      newer,
    ]);
  });

  it('does not reserve or mark candidates without a state identity', () => {
    const directory = mkdtempSync(join(tmpdir(), 'remediation-state-unkeyed-'));
    const path = join(directory, 'handled.json');
    const unkeyed = { lastSeen: candidate.lastSeen, occurrences: 2 };
    const state = createRemediationState({ path });

    assert.deepEqual(state.pending([unkeyed]), []);
    assert.equal(state.complete({ handledCandidates: [unkeyed] }), true);
    const persisted = JSON.parse(readFileSync(path, 'utf8'));
    assert.deepEqual(persisted.handled, {});
    assert.deepEqual(persisted.reservations, {});
  });

  it('keeps fallback evidence until reconciled state is persisted', () => {
    const directory = mkdtempSync(join(tmpdir(), 'remediation-state-'));
    const path = join(directory, 'handled.json');
    const state = createRemediationState({ path });
    state.recordHandledFallback([candidate]);
    mkdirSync(path);

    assert.throws(() => state.pending([candidate]));
    assert.equal(readdirSync(`${path}.handled-fallback`).length, 1);

    rmdirSync(path);
    assert.deepEqual(state.pending([candidate]), []);
    assert.equal(readdirSync(`${path}.handled-fallback`).length, 0);
  });

  it('recovers from a corrupt state file without dropping new incidents', () => {
    const directory = mkdtempSync(join(tmpdir(), 'remediation-state-'));
    const path = join(directory, 'handled.json');
    writeFileSync(path, 'not json');

    assert.deepEqual(createRemediationState({ path }).pending([candidate]), [
      candidate,
    ]);
  });

  it('reserves an observation for only one concurrent worker', () => {
    const directory = mkdtempSync(join(tmpdir(), 'remediation-state-'));
    const path = join(directory, 'handled.json');
    const firstWorker = createRemediationState({ path });
    const secondWorker = createRemediationState({ path });

    assert.deepEqual(firstWorker.pending([candidate]), [candidate]);
    assert.deepEqual(secondWorker.pending([candidate]), []);
  });

  it('reserves only the configured number of pending candidates', () => {
    const directory = mkdtempSync(join(tmpdir(), 'remediation-state-'));
    const path = join(directory, 'handled.json');
    const candidates = [
      candidate,
      { ...candidate, fingerprint: 'issue-2' },
      { ...candidate, fingerprint: 'issue-3' },
    ];
    const state = createRemediationState({ path });

    assert.deepEqual(
      state.pending(candidates, { limit: 2 }),
      candidates.slice(0, 2)
    );
    assert.deepEqual(
      createRemediationState({ path }).pending(candidates, { limit: 2 }),
      [candidates[2]]
    );
  });

  it('fails closed while another process holds the state lock', () => {
    const directory = mkdtempSync(join(tmpdir(), 'remediation-state-'));
    const path = join(directory, 'handled.json');
    const state = createRemediationState({ path });
    writeFileSync(`${path}.lock`, 'busy');

    assert.deepEqual(state.pending([candidate]), []);
    assert.equal(state.complete({ handledCandidates: [candidate] }), false);
    assert.equal(state.handledCandidates([candidate]), false);
  });

  it('recovers a candidate after a state lock becomes stale', () => {
    const directory = mkdtempSync(join(tmpdir(), 'remediation-state-'));
    const path = join(directory, 'handled.json');
    writeFileSync(`${path}.lock`, 'stale');
    const state = createRemediationState({
      now: () => Date.now() + 2 * 60 * 1_000 + 1,
      path,
    });

    assert.deepEqual(state.pending([candidate]), [candidate]);
  });

  it('releases an abandoned reservation after its lease expires', () => {
    const directory = mkdtempSync(join(tmpdir(), 'remediation-state-'));
    const path = join(directory, 'handled.json');
    let nowMs = Date.parse('2026-08-04T15:46:50Z');
    const state = createRemediationState({
      now: () => nowMs,
      path,
      reservationTtlMs: 1_000,
    });

    assert.deepEqual(state.pending([candidate]), [candidate]);
    nowMs += 1_001;
    assert.deepEqual(state.pending([candidate]), [candidate]);
  });

  it('backs off a failed observation before making it eligible for retry', () => {
    const directory = mkdtempSync(join(tmpdir(), 'remediation-state-'));
    const path = join(directory, 'handled.json');
    let nowMs = Date.parse('2026-08-04T15:46:50Z');
    const state = createRemediationState({
      now: () => nowMs,
      path,
      retryDelayMs: 6 * 60 * 60 * 1_000,
    });

    assert.deepEqual(state.pending([candidate]), [candidate]);
    assert.equal(state.complete({ deferCandidates: [candidate] }), true);
    assert.deepEqual(state.pending([candidate]), []);

    nowMs += 6 * 60 * 60 * 1_000 + 1;
    assert.deepEqual(state.pending([candidate]), [candidate]);
  });

  it('ignores malformed handled records instead of suppressing incidents', () => {
    const directory = mkdtempSync(join(tmpdir(), 'remediation-state-'));
    const path = join(directory, 'handled.json');
    writeFileSync(
      path,
      JSON.stringify({
        handled: {
          [candidate.fingerprint]: {
            observation: candidate.lastSeen,
          },
        },
        notifications: [],
        reservations: [],
        version: 2,
      })
    );

    assert.deepEqual(createRemediationState({ path }).pending([candidate]), [
      candidate,
    ]);
  });

  it('persists notifications until they are acknowledged', () => {
    const directory = mkdtempSync(join(tmpdir(), 'remediation-state-'));
    const path = join(directory, 'handled.json');
    const state = createRemediationState({ path });
    const report = { html: '<p>incident</p>', subject: 'Incident', text: 'x' };

    assert.equal(
      state.complete({ notification: { id: 'report-1', report } }),
      true
    );
    assert.deepEqual(createRemediationState({ path }).notifications(), [
      { id: 'report-1', report },
    ]);
    assert.equal(state.acknowledgeNotification('report-1'), true);
    assert.deepEqual(createRemediationState({ path }).notifications(), []);
  });

  it('returns only due notification retries and persists their next attempt time', () => {
    const directory = mkdtempSync(join(tmpdir(), 'remediation-state-'));
    const path = join(directory, 'handled.json');
    const nowMs = Date.parse('2026-08-09T10:00:00.000Z');
    const report = { html: '<p>incident</p>', subject: 'Incident', text: 'x' };
    const state = createRemediationState({ now: () => nowMs, path });

    assert.equal(state.complete({ notification: { id: 'due', report } }), true);
    assert.equal(
      state.complete({ notification: { id: 'deferred', report } }),
      true
    );
    assert.equal(
      state.scheduleNotificationRetry('deferred', '2026-08-09T10:01:00.000Z'),
      true
    );

    assert.deepEqual(state.notifications({ limit: 10, nowMs }), [
      { id: 'due', report },
    ]);
    const deferred = JSON.parse(readFileSync(path, 'utf8')).notifications
      .deferred;
    assert.equal(deferred.attempts, 1);
    assert.equal(deferred.nextAttemptAt, '2026-08-09T10:01:00.000Z');
    assert.deepEqual(
      state
        .notifications({ nowMs: Date.parse('2026-08-09T10:01:00.000Z') })
        .map((entry) => entry.id),
      ['due', 'deferred']
    );
  });

  it('expires and caps notifications after inserting a new report', () => {
    const directory = mkdtempSync(join(tmpdir(), 'remediation-state-'));
    const path = join(directory, 'handled.json');
    const nowMs = Date.parse('2026-08-05T12:00:00Z');
    const report = { html: '<p>incident</p>', subject: 'Incident', text: 'x' };
    const notifications = Object.fromEntries([
      [
        'expired',
        {
          recordedAt: '2026-06-01T00:00:00Z',
          report,
        },
      ],
      ...Array.from({ length: 2_000 }, (_, index) => [
        `existing-${index}`,
        {
          recordedAt: new Date(nowMs - index - 1).toISOString(),
          report,
        },
      ]),
    ]);
    writeFileSync(
      path,
      JSON.stringify({
        handled: {},
        notifications,
        reservations: {},
        version: 2,
      })
    );

    const state = createRemediationState({ now: () => nowMs, path });
    assert.equal(
      state.complete({ notification: { id: 'newest', report } }),
      true
    );
    const persisted = JSON.parse(readFileSync(path, 'utf8')).notifications;
    assert.equal(Object.keys(persisted).length, 2_000);
    assert.ok(persisted.newest);
    assert.equal(persisted.expired, undefined);
    assert.equal(persisted['existing-1999'], undefined);
  });
});
