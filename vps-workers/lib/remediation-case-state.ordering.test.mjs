import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
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

describe('remediation case ordering', () => {
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

  it('orders unseen cases ahead of a recurring hot case within a category', () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-case-rotation-'));
    let nowMs = Date.parse('2026-08-01T10:04:00.000Z');
    const state = createRemediationCaseState({
      now: () => nowMs,
      path: join(directory, 'cases.json'),
    });
    const hot = candidate({
      fingerprint: 'hot-1',
      occurrences: 100,
      sample: { issueId: 'hot-1', message: 'Hot', source: 'sentry' },
    });
    const cold = candidate({
      fingerprint: 'cold-1',
      occurrences: 3,
      sample: { issueId: 'cold-1', message: 'Cold', source: 'sentry' },
    });

    const first = state.orderCandidates(state.reconcile([hot, cold]));
    assert.deepEqual(
      first.map((value) => value.fingerprint),
      ['hot-1', 'cold-1']
    );
    state.recordSelections(first.slice(0, 1));

    nowMs += 15 * 60 * 1000;
    const recurred = [hot, cold].map((item) => ({
      ...item,
      lastSeen: '2026-08-01T10:19:00.000Z',
    }));
    const second = state.orderCandidates(state.reconcile(recurred));

    assert.deepEqual(
      second.map((value) => value.fingerprint),
      ['cold-1', 'hot-1']
    );
  });
});
