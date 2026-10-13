import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { createRemediationCaseState } from './remediation-case-state.mjs';

const day = 24 * 60 * 60 * 1_000;
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

describe('remediation case state draft lifecycle', () => {
  it('quiets an open case at the exact seven-day boundary', () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-case-exact-quiet-'));
    const state = createRemediationCaseState({
      now: () => Date.parse('2026-08-08T10:03:00.000Z'),
      path: join(directory, 'cases.json'),
    });

    state.reconcile([candidate()]);

    assert.equal(
      state.snapshot().cases['sentry:sentry_issue:issue-42'].status,
      'quiet'
    );
  });

  it('returns enriched lifecycle copies without mutating selection or outcome callers', () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-case-copies-'));
    const state = createRemediationCaseState({
      now: () => Date.parse('2026-08-01T10:04:00.000Z'),
      path: join(directory, 'cases.json'),
    });
    const selected = state.reconcile([candidate()])[0];
    const selectionInput = structuredClone(selected);

    const selections = state.recordSelections([selected]);

    assert.deepEqual(selected, selectionInput);
    assert.notEqual(selections[0], selected);
    assert.equal(selections[0].status, 'investigating');

    const outcomeInput = structuredClone(selections[0]);
    const outcome = state.recordOutcome(selections[0], { type: 'no_changes' });

    assert.deepEqual(selections[0], outcomeInput);
    assert.notEqual(outcome, selections[0]);
    assert.equal(outcome.history[0].type, 'no_changes');
  });

  it('does not retain a draft lifecycle when a PR result has no URL', () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-case-state-pr-url-'));
    const state = createRemediationCaseState({
      now: () => Date.parse('2026-08-01T10:04:00.000Z'),
      path: join(directory, 'cases.json'),
    });

    state.reconcile([candidate()]);
    const recorded = state.recordOutcome(candidate(), { type: 'pr_opened' });

    assert.equal(recorded.status, 'open');
    assert.equal(recorded.draftPr, null);
  });

  it('quiets a stale active draft case without resolving it on a newer observation', () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-case-quiet-'));
    const path = join(directory, 'cases.json');
    let nowMs = Date.parse('2026-08-01T10:04:00.000Z');
    const state = createRemediationCaseState({ now: () => nowMs, path });

    state.reconcile([candidate()]);
    state.recordOutcome(candidate(), {
      prUrl: 'https://github.com/baci/baci/pull/12',
      type: 'pr_opened',
    });
    nowMs += 7 * day;
    state.reconcile([]);

    assert.equal(
      state.snapshot().cases['sentry:sentry_issue:issue-42'].status,
      'quiet'
    );
    assert.equal(
      state.snapshot().cases['sentry:sentry_issue:issue-42'].draftPr.url,
      'https://github.com/baci/baci/pull/12'
    );

    const recurrence = state.reconcile([
      candidate({ lastSeen: '2026-08-08T10:05:00.000Z', occurrences: 4 }),
    ]);
    const recurring = state.snapshot().cases['sentry:sentry_issue:issue-42'];
    assert.equal(recurrence[0].autofixEligible, false);
    assert.equal(recurrence[0].lifecycleEvent, 'active_draft_recurrence');
    assert.equal(recurring.status, 'pr_open');
    assert.equal(recurring.recurrenceCount, 1);
    assert.equal(recurring.draftPr.url, 'https://github.com/baci/baci/pull/12');
  });

  it('keeps an active draft PR open when a newer observation recurs', () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-case-active-pr-'));
    const state = createRemediationCaseState({
      now: () => Date.parse('2026-08-01T10:04:00.000Z'),
      path: join(directory, 'cases.json'),
    });
    state.reconcile([candidate()]);
    state.recordOutcome(candidate(), {
      prUrl: 'https://github.com/baci/baci/pull/12',
      type: 'pr_opened',
    });

    const selected = state.reconcile([
      candidate({ lastSeen: '2026-08-01T10:05:00.000Z', occurrences: 4 }),
    ]);
    const stored = state.snapshot().cases['sentry:sentry_issue:issue-42'];
    assert.equal(selected.length, 1);
    assert.equal(selected[0].autofixEligible, false);
    assert.equal(selected[0].lifecycleEvent, 'active_draft_recurrence');
    assert.equal(stored.status, 'pr_open');
    assert.equal(stored.recurrenceCount, 1);
  });

  it('keeps a quiet case with active draft linkage out of autofix selection after recurrence', () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-case-quiet-draft-'));
    let nowMs = Date.parse('2026-08-01T10:04:00.000Z');
    const state = createRemediationCaseState({
      now: () => nowMs,
      path: join(directory, 'cases.json'),
    });
    state.reconcile([candidate()]);
    state.recordOutcome(candidate(), {
      prUrl: 'https://github.com/baci/baci/pull/12',
      type: 'pr_opened',
    });
    nowMs += 7 * day;
    state.reconcile([]);

    const selected = state.reconcile([
      candidate({ lastSeen: '2026-08-08T10:05:00.000Z', occurrences: 4 }),
    ]);
    const stored = state.snapshot().cases['sentry:sentry_issue:issue-42'];
    assert.equal(selected.length, 1);
    assert.equal(selected[0].autofixEligible, false);
    assert.equal(selected[0].lifecycleEvent, 'active_draft_recurrence');
    assert.equal(stored.status, 'pr_open');
    assert.equal(stored.recurrenceCount, 1);
    assert.equal(stored.draftPr.url, 'https://github.com/baci/baci/pull/12');
  });

  it('rotates a closed older draft behind newer open drafts across reconciliation runs', () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-case-draft-rotation-'));
    const state = createRemediationCaseState({
      now: () => Date.parse('2026-08-01T10:20:00.000Z'),
      path: join(directory, 'cases.json'),
    });
    const candidates = Array.from({ length: 11 }, (_, index) =>
      candidate({
        fingerprint: `issue-${index}`,
        lastSeen: `2026-08-01T10:${String(index).padStart(2, '0')}:00.000Z`,
        occurrences: 2,
        sample: { issueId: String(index), source: 'sentry' },
      })
    );
    state.reconcile(candidates);
    for (const [index, current] of candidates.entries()) {
      state.recordOutcome(current, {
        prUrl: `https://github.com/baci/baci/pull/${100 + index}`,
        type: 'pr_opened',
      });
    }

    const statusFor = (draftPr) =>
      draftPr.caseKey.endsWith(':issue-0') ? 'closed' : 'open';
    state.reconcileDraftPrs({
      candidates,
      limit: 10,
      resolveDraftPrStatus: statusFor,
    });
    state.reconcileDraftPrs({
      candidates,
      limit: 10,
      resolveDraftPrStatus: statusFor,
    });

    assert.equal(
      state.snapshot().cases['sentry:sentry_issue:issue-0'].draftPr,
      null
    );
  });

  it('does not keep selecting a stale cumulative candidate after seven quiet days', () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-case-stale-loader-'));
    const state = createRemediationCaseState({
      now: () => Date.parse('2026-08-08T10:03:00.000Z'),
      path: join(directory, 'cases.json'),
    });

    const reconciled = state.reconcile([candidate()]);

    assert.deepEqual(reconciled, []);
    assert.equal(
      state.snapshot().cases['sentry:sentry_issue:issue-42'].status,
      'quiet'
    );
  });
});
