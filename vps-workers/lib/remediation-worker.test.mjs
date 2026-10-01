import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { runRemediationWorker as runWorker } from './remediation-worker.mjs';
import { runRemediationWorker } from './remediation-worker.test-harness.mjs';

describe('remediation worker', () => {
  it('requires an explicit incident candidate loader', async () => {
    await assert.rejects(
      runRemediationWorker({ workerName: 'test-remediator' }),
      /candidateLoader is required/
    );
  });

  it('requires a source-specific worker name', async () => {
    await assert.rejects(
      runRemediationWorker({ candidateLoader: async () => [] }),
      /workerName is required/
    );
  });

  it('rejects a forged global-lock environment marker in production', async () => {
    await assert.rejects(
      runWorker({
        candidateLoader: async () => [],
        env: {
          BACI_REMEDIATION_GLOBAL_FLOCK_HELD: '1',
          NODE_ENV: 'production',
        },
        remediationLock: {},
        workerName: 'test-remediator',
      }),
      /global remediation flock/
    );
  });

  it('rejects development autofix before loading candidates without a lock capability', async () => {
    let loaded = false;
    await assert.rejects(
      runWorker({
        candidateLoader: () => {
          loaded = true;
          return [];
        },
        env: {
          BACI_REMEDIATION_AUTOFIX_ENABLED: '1',
          NODE_ENV: 'development',
        },
        workerName: 'test-remediator',
      }),
      /global remediation flock/
    );
    assert.equal(loaded, false);
  });

  it('rejects a forged object capability for test autofix before state access', async () => {
    await assert.rejects(
      runWorker({
        candidateLoader: async () => [],
        env: { BACI_REMEDIATION_AUTOFIX_ENABLED: '1', NODE_ENV: 'test' },
        remediationLock: {},
        workerName: 'test-remediator',
      }),
      /global remediation flock/
    );
  });

  it('does not let a caller override autofix lock authorization', async () => {
    let loaded = false;

    await assert.rejects(
      runWorker({
        candidateLoader: () => {
          loaded = true;
          return [];
        },
        env: { BACI_REMEDIATION_AUTOFIX_ENABLED: '1', NODE_ENV: 'test' },
        lockCapabilityValidator: () => true,
        remediationLock: {},
        workerName: 'test-remediator',
      }),
      /global remediation flock/
    );

    assert.equal(loaded, false);
  });

  it('caps configurable candidate work per cron tick', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-worker-cap-'));
    const attempted = [];
    const loadedCandidates = Array.from({ length: 4 }, (_, index) => ({
      fingerprint: `candidate-${index}`,
      occurrences: 3,
      sample: { source: 'sentry' },
    }));

    const result = await runRemediationWorker({
      autofixRunner: ({ candidate }) => {
        attempted.push(candidate.fingerprint);
        return { type: 'no_changes' };
      },
      candidateLoader: async () => loadedCandidates,
      env: {
        BACI_REMEDIATION_AUTOFIX_ENABLED: '1',
        BACI_REMEDIATION_MAX_CANDIDATES_PER_RUN: '2',
        BACI_REMEDIATION_OUTPUT_DIR: directory,
      },
      workerName: 'test-remediator',
    });

    assert.deepEqual(attempted, ['candidate-0', 'candidate-1']);
    assert.equal(result.candidates.length, 2);
  });

  it('passes the recorded investigating lifecycle into autofix', async () => {
    const directory = mkdtempSync(
      join(tmpdir(), 'baci-worker-lifecycle-state-')
    );
    let received;

    await runRemediationWorker({
      autofixRunner: ({ candidate }) => {
        received = candidate;
        return { type: 'no_changes' };
      },
      candidateLoader: async () => [
        {
          fingerprint: 'lifecycle-state',
          occurrences: 2,
          sample: { source: 'sentry' },
        },
      ],
      env: {
        BACI_REMEDIATION_AUTOFIX_ENABLED: '1',
        BACI_REMEDIATION_OUTPUT_DIR: directory,
      },
      workerName: 'test-remediator',
    });

    assert.equal(received.status, 'investigating');
    assert.deepEqual(received.history, []);
  });

  it('reports the persisted draft PR lifecycle after opening a PR', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-worker-pr-report-'));

    const result = await runRemediationWorker({
      autofixRunner: () => ({
        branch: 'codex/fix-pr-report',
        prUrl: 'https://github.com/baci/baci/pull/77',
        type: 'pr_opened',
      }),
      candidateLoader: async () => [
        {
          fingerprint: 'pr-report',
          occurrences: 2,
          sample: { source: 'sentry' },
        },
      ],
      env: {
        BACI_REMEDIATION_AUTOFIX_ENABLED: '1',
        BACI_REMEDIATION_OUTPUT_DIR: directory,
      },
      workerName: 'test-remediator',
    });

    assert.match(result.report.text, /lifecycle=pr_open/);
    assert.match(
      result.report.text,
      /draftPr=https:\/\/github\.com\/baci\/baci\/pull\/77/
    );
  });

  it('enriches only pending candidates before handing evidence to autofix', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-worker-enrichment-'));
    const enriched = [];
    const attempted = [];

    await runRemediationWorker({
      autofixRunner: ({ candidate }) => {
        attempted.push(candidate.sample.release);
        return { type: 'no_changes' };
      },
      candidateEnricher: ({ candidate }) => {
        enriched.push(candidate.fingerprint);
        return {
          ...candidate,
          sample: { ...candidate.sample, release: 'build-769' },
        };
      },
      candidateLoader: async () => [
        { fingerprint: 'first', occurrences: 3, sample: { source: 'sentry' } },
        { fingerprint: 'second', occurrences: 3, sample: { source: 'sentry' } },
      ],
      env: {
        BACI_REMEDIATION_AUTOFIX_ENABLED: '1',
        BACI_REMEDIATION_MAX_CANDIDATES_PER_RUN: '1',
        BACI_REMEDIATION_OUTPUT_DIR: directory,
      },
      workerName: 'test-remediator',
    });

    assert.deepEqual(enriched, ['first']);
    assert.deepEqual(attempted, ['build-769']);
  });

  it('caps candidate enrichment in dry-run mode', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-worker-enrichment-'));
    const enriched = [];

    const result = await runRemediationWorker({
      candidateEnricher: ({ candidate }) => {
        enriched.push(candidate.fingerprint);
        return candidate;
      },
      candidateLoader: async () => [
        { fingerprint: 'first', occurrences: 3, sample: { source: 'sentry' } },
        { fingerprint: 'second', occurrences: 3, sample: { source: 'sentry' } },
      ],
      env: {
        BACI_REMEDIATION_MAX_CANDIDATES_PER_RUN: '1',
        BACI_REMEDIATION_OUTPUT_DIR: directory,
      },
      workerName: 'test-remediator',
    });

    assert.deepEqual(enriched, ['first']);
    assert.equal(result.candidates.length, 1);
  });

  it('defers a candidate when evidence enrichment fails', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-worker-enrichment-'));
    let attempted = false;

    const result = await runRemediationWorker({
      autofixRunner: () => {
        attempted = true;
        return { type: 'no_changes' };
      },
      candidateEnricher: () => {
        throw new Error('latest event unavailable');
      },
      candidateLoader: async () => [
        { fingerprint: 'anr', occurrences: 3, sample: { source: 'sentry' } },
      ],
      env: {
        BACI_REMEDIATION_AUTOFIX_ENABLED: '1',
        BACI_REMEDIATION_OUTPUT_DIR: directory,
      },
      logger: { error: () => undefined, log: () => undefined },
      workerName: 'test-remediator',
    });

    assert.equal(attempted, false);
    assert.deepEqual(
      result.actions.find(
        (action) => action.type === 'candidate_enrichment_failed'
      ),
      {
        detail: 'latest event unavailable',
        fingerprint: 'anr',
        type: 'candidate_enrichment_failed',
      }
    );
  });

  it('uses the pending candidate when evidence enrichment returns no object', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-worker-enrichment-'));
    const attempted = [];

    await runRemediationWorker({
      autofixRunner: ({ candidate }) => {
        attempted.push(candidate.fingerprint);
        return { type: 'no_changes' };
      },
      candidateEnricher: () => undefined,
      candidateLoader: async () => [
        {
          fingerprint: 'fallback',
          occurrences: 3,
          sample: { source: 'sentry' },
        },
      ],
      env: {
        BACI_REMEDIATION_AUTOFIX_ENABLED: '1',
        BACI_REMEDIATION_OUTPUT_DIR: directory,
      },
      logger: { error: () => undefined, log: () => undefined },
      workerName: 'test-remediator',
    });

    assert.deepEqual(attempted, ['fallback']);
  });
});
