import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { billedMinutes, classifyJob, formatReport, sampleRuns, summarize } from './measure-ci-minutes.mjs';

const job = (name, seconds, extra = {}) => ({
  name,
  conclusion: 'success',
  labels: ['ubuntu-24.04'],
  started_at: '2026-11-10T10:00:00Z',
  completed_at: new Date(Date.parse('2026-11-10T10:00:00Z') + seconds * 1000).toISOString(),
  ...extra,
});

describe('billedMinutes', () => {
  it('rounds each hosted job up to whole minutes, minimum one', () => {
    assert.equal(billedMinutes(job('a', 61)), 2);
    assert.equal(billedMinutes(job('a', 60)), 1);
    assert.equal(billedMinutes(job('a', 3)), 1);
  });

  it('does not bill skipped, unfinished, zero-length or self-hosted jobs', () => {
    assert.equal(billedMinutes(job('a', 600, { conclusion: 'skipped' })), 0);
    assert.equal(billedMinutes(job('a', 600, { completed_at: null })), 0);
    assert.equal(billedMinutes(job('a', 0)), 0);
    assert.equal(billedMinutes(job('a', 600, { labels: ['self-hosted', 'Linux'] })), 0);
  });
});

describe('classifyJob', () => {
  it('puts the long suites in the heavy stage and the cheap checks in the quick stage', () => {
    for (const name of ['Quality Gate - Test (web shard 3)', 'Quality Gate - Test', 'Build', 'Quality Gate - DB Replay', 'Quality Gate - Disposable SQL Suites', 'CWV Runner Contracts', 'Checkout - Chromium and WebKit', 'Quality Gate']) {
      assert.equal(classifyJob(name), 'heavy', name);
    }
    for (const name of ['changes', 'Quality Gate - Lint', 'Quality Gate - Typecheck', 'Quality Gate - Misc', 'Mobile Admin Guardrails', 'Silent Revert Guard', 'Review-first CI stage']) {
      assert.equal(classifyJob(name), 'quick', name);
    }
  });
});

describe('summarize', () => {
  const runs = [{ id: 1 }, { id: 2 }];
  const jobsByRun = new Map([
    [1, [job('changes', 30), job('Quality Gate - Lint', 100), job('Quality Gate - Test (web shard 1)', 600)]],
    [2, [job('changes', 30), job('Quality Gate - Lint', 100)]],
  ]);

  it('adds up quick and heavy minutes and divides by merged pull requests', () => {
    const report = summarize({ runs, jobsByRun, totalRuns: 2, mergedPullRequests: 1 });
    assert.equal(report.runs, 2);
    assert.equal(report.quickMinutes, 1 + 2 + 1 + 2);
    assert.equal(report.heavyMinutes, 10);
    assert.equal(report.totalMinutes, 16);
    assert.equal(report.minutesPerMergedPullRequest, 16);
    assert.equal(report.runsWithHeavyJobs, 1);
  });

  it('scales a sample up to the full run count', () => {
    const report = summarize({ runs, jobsByRun, totalRuns: 20, mergedPullRequests: 4 });
    assert.equal(report.totalMinutes, 160);
    assert.equal(report.minutesPerMergedPullRequest, 40);
  });

  it('reports no per-pull-request figure when nothing merged', () => {
    assert.equal(summarize({ runs, jobsByRun, totalRuns: 2, mergedPullRequests: 0 }).minutesPerMergedPullRequest, null);
  });

  it('formats a readable report', () => {
    const text = formatReport('2026-11-10', summarize({ runs, jobsByRun, totalRuns: 2, mergedPullRequests: 1 }));
    assert.match(text, /2026-11-10/);
    assert.match(text, /job-minutes per merged pull request/i);
  });
});

describe('sampleRuns', () => {
  it('is deterministic and never larger than the input', () => {
    const runs = Array.from({ length: 50 }, (_, index) => ({ id: index }));
    const first = sampleRuns(runs, 10, 7);
    assert.equal(first.length, 10);
    assert.deepEqual(first, sampleRuns(runs, 10, 7));
    assert.equal(sampleRuns(runs, 100, 7).length, 50);
  });
});
