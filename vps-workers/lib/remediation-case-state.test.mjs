import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { createRemediationCaseState } from './remediation-case-state.mjs';

const candidate = (overrides = {}) => ({
  category: 'sentry_issue',
  fingerprint: 'issue-42',
  firstSeen: '2026-08-01T10:00:00.000Z',
  lastSeen: '2026-08-01T10:03:00.000Z',
  occurrences: 3,
  sample: {
    issueId: '42',
    message: 'Application Not Responding',
    project: 'mobile',
    source: 'sentry',
  },
  source: 'sentry',
  ...overrides,
});

describe('remediation case state', () => {
  it('persists a redacted provider-specific case only when its observation advances', () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-case-state-'));
    const path = join(directory, 'cases.json');
    let nowMs = Date.parse('2026-08-01T10:04:00.000Z');
    const state = createRemediationCaseState({ now: () => nowMs, path });
    const first = candidate({
      sample: {
        ...candidate().sample,
        message:
          'Authorization: Bearer ghp_abcdefghijklmnopqrstuvwxyz0123456789',
      },
    });

    state.reconcile([first]);
    state.reconcile([first]);
    const advanced = candidate({
      lastSeen: '2026-08-01T10:05:00.000Z',
      occurrences: 5,
    });
    nowMs += 60_000;
    state.reconcile([advanced]);

    const stored = state.snapshot().cases['sentry:sentry_issue:issue-42'];
    assert.equal(stored.firstSeen, '2026-08-01T10:00:00.000Z');
    assert.equal(stored.lastSeen, '2026-08-01T10:05:00.000Z');
    assert.equal(stored.totalObservations, 5);
    assert.equal(stored.status, 'open');
    assert.equal(stored.recurrenceCount, 1);
    assert.match(readFileSync(path, 'utf8'), /\[REDACTED\]/);
    assert.doesNotMatch(
      readFileSync(path, 'utf8'),
      /ghp_abcdefghijklmnopqrstuvwxyz0123456789/
    );
  });

  it('records a recurrence when the occurrence count advances at the same timestamp', () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-case-state-tie-'));
    const state = createRemediationCaseState({
      now: () => Date.parse('2026-08-01T10:04:00.000Z'),
      path: join(directory, 'cases.json'),
    });

    state.reconcile([candidate()]);
    const recurrence = state.reconcile([candidate({ occurrences: 5 })]);
    const stored = state.snapshot().cases['sentry:sentry_issue:issue-42'];

    assert.equal(recurrence.length, 1);
    assert.equal(stored.totalObservations, 5);
    assert.equal(stored.recurrenceCount, 1);
  });

  it('round-trips a Vercel case with many route segments without persisting an oversized route', () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-case-route-bound-'));
    const path = join(directory, 'cases.json');
    const rawRoute = `/${Array.from(
      { length: 80 },
      (_, index) => `customer-route-segment-${index}`
    ).join('/')}`;
    const state = createRemediationCaseState({ path });

    state.reconcile([
      candidate({
        category: 'vercel_timeout',
        fingerprint: 'many-route-segments',
        sample: { route: rawRoute, source: 'vercel' },
        source: 'vercel',
      }),
    ]);

    const persisted = createRemediationCaseState({ path }).snapshot();
    const stored = persisted.cases['vercel:vercel_timeout:many-route-segments'];

    assert.equal(stored.samples.at(-1).route, undefined);
    assert.doesNotMatch(readFileSync(path, 'utf8'), /customer-route-segment/);
  });

  it('deduplicates an exact canonical observation before it can consume another selection', () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-case-duplicate-'));
    const state = createRemediationCaseState({
      now: () => Date.parse('2026-08-01T10:04:00.000Z'),
      path: join(directory, 'cases.json'),
    });
    const duplicate = candidate({
      occurrences: 5,
      sample: { ...candidate().sample, message: 'More complete evidence' },
    });

    const reconciled = state.reconcile([candidate(), duplicate]);
    const stored = state.snapshot().cases['sentry:sentry_issue:issue-42'];

    assert.equal(reconciled.length, 1);
    assert.equal(reconciled[0].occurrences, 5);
    assert.equal(stored.recurrenceCount, 0);
    assert.equal(stored.totalObservations, 5);
  });

  it('keeps a stable open case available for state retries without a recurrence', () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-case-stale-selection-'));
    const state = createRemediationCaseState({
      now: () => Date.parse('2026-08-01T10:04:00.000Z'),
      path: join(directory, 'cases.json'),
    });
    state.reconcile([candidate()]);
    state.recordOutcome(candidate(), { type: 'configuration_blocked' });
    assert.equal(state.reconcile([candidate()]).length, 1);
    const stored = state.snapshot().cases['sentry:sentry_issue:issue-42'];
    const counts = [stored.recurrenceCount, stored.totalObservations];
    assert.deepEqual(counts, [0, 3]);
  });
  it('treats a timestamp-free occurrence reset as a new observation epoch', () => {
    const directory = mkdtempSync(
      join(tmpdir(), 'baci-case-occurrence-reset-')
    );
    const state = createRemediationCaseState({
      now: () => Date.parse('2026-08-01T10:04:00.000Z'),
      path: join(directory, 'cases.json'),
    });
    const timestampFree = candidate({
      lastSeen: '',
      occurrences: 8,
      source: 'vercel',
      sample: { source: 'vercel' },
    });

    state.reconcile([timestampFree]);
    const reset = state.reconcile([{ ...timestampFree, occurrences: 2 }]);

    assert.equal(reset.length, 1);
    assert.equal(reset[0].occurrences, 2);
    assert.equal(
      state.snapshot().cases['vercel:sentry_issue:issue-42'].recurrenceCount,
      1
    );
  });

  it('collapses stale and newer paginated snapshots before selection', () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-case-paginated-'));
    const state = createRemediationCaseState({
      now: () => Date.parse('2026-08-01T10:06:00.000Z'),
      path: join(directory, 'cases.json'),
    });
    const stale = candidate({
      lastSeen: '2026-08-01T10:03:00.000Z',
      occurrences: 8,
      sample: { ...candidate().sample, message: 'Stale page' },
    });
    const newer = candidate({
      lastSeen: '2026-08-01T10:05:00.000Z',
      occurrences: 3,
      sample: { ...candidate().sample, message: 'Newest page' },
    });

    const reconciled = state.reconcile([stale, newer]);
    const stored = state.snapshot().cases['sentry:sentry_issue:issue-42'];

    assert.equal(reconciled.length, 1);
    assert.equal(reconciled[0].lastSeen, newer.lastSeen);
    assert.equal(reconciled[0].occurrences, newer.occurrences);
    assert.equal(stored.recurrenceCount, 0);
    assert.equal(stored.sample, undefined);
    assert.equal(stored.samples.at(-1).message, 'Newest page');
  });

  it('fails closed for corrupt or schema-invalid persisted case state', () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-case-corrupt-'));
    const path = join(directory, 'cases.json');
    const state = createRemediationCaseState({ path });
    const invalidStates = [
      '{not json',
      JSON.stringify({ cases: {}, fairness: {}, version: 9 }),
      JSON.stringify({ cases: [], fairness: {}, version: 1 }),
      JSON.stringify({
        cases: { broken: { status: 'open' } },
        fairness: {},
        version: 1,
      }),
    ];

    for (const invalid of invalidStates) {
      writeFileSync(path, invalid);
      assert.throws(() => state.snapshot(), /Invalid remediation case state/);
    }
  });

  it('rejects bloated and arbitrary-key lifecycle state records', () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-case-bounds-'));
    const path = join(directory, 'cases.json');
    const state = createRemediationCaseState({
      now: () => Date.parse('2026-08-01T10:04:00.000Z'),
      path,
    });
    state.reconcile([candidate()]);
    const valid = JSON.parse(readFileSync(path, 'utf8'));
    const caseKey = Object.keys(valid.cases)[0];
    assert.ok(valid.cases[caseKey].samples.length > 0);
    assert.doesNotThrow(() => state.snapshot());
    const invalidStates = [
      { ...valid, unexpected: true },
      {
        ...valid,
        cases: {
          ...valid.cases,
          [caseKey]: {
            ...valid.cases[caseKey],
            samples: [{ ...valid.cases[caseKey].samples[0], extra: 'value' }],
          },
        },
      },
      {
        ...valid,
        fairness: { lastCategory: 'x'.repeat(81) },
      },
      {
        ...valid,
        cases: {
          ...valid.cases,
          [caseKey]: {
            ...valid.cases[caseKey],
            samples: [
              {
                ...valid.cases[caseKey].samples[0],
                message: 'x'.repeat(1_001),
              },
            ],
          },
        },
      },
    ];

    for (const invalid of invalidStates) {
      writeFileSync(path, JSON.stringify(invalid));
      assert.throws(() => state.snapshot(), /Invalid remediation case state/);
    }
  });

  it('round-robins categories so a noisy category cannot exhaust a run', () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-case-fairness-'));
    const state = createRemediationCaseState({
      now: () => Date.parse('2026-08-01T10:04:00.000Z'),
      path: join(directory, 'cases.json'),
    });
    const candidates = [
      candidate({
        fingerprint: 'runtime-1',
        category: 'vercel_runtime_exception',
        source: 'vercel',
        sample: { source: 'vercel' },
      }),
      candidate({
        fingerprint: 'runtime-2',
        category: 'vercel_runtime_exception',
        source: 'vercel',
        sample: { source: 'vercel' },
      }),
      candidate({
        fingerprint: 'runtime-3',
        category: 'vercel_runtime_exception',
        source: 'vercel',
        sample: { source: 'vercel' },
      }),
      candidate({
        fingerprint: 'timeout-1',
        category: 'vercel_timeout',
        source: 'vercel',
        sample: { source: 'vercel' },
      }),
    ];

    const ordered = state.orderCandidates(state.reconcile(candidates));

    assert.deepEqual(
      ordered.slice(0, 2).map((value) => value.category),
      ['vercel_runtime_exception', 'vercel_timeout']
    );
  });
});
