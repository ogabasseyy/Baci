import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { runRemediationWorker } from './remediation-worker.test-harness.mjs';

const candidate = () => ({
  category: 'sentry_issue',
  fingerprint: 'report-outcome',
  lastSeen: '2026-08-09T10:00:00.000Z',
  occurrences: 2,
  sample: { issueId: 'report-outcome', source: 'sentry' },
  source: 'sentry',
});

const environment = (directory, autofix = false) => ({
  BACI_REMEDIATION_AUTOFIX_ENABLED: autofix ? '1' : '0',
  BACI_REMEDIATION_OUTPUT_DIR: directory,
});
const now = () => Date.parse('2026-08-09T10:05:00.000Z');

function createTestDirectory(t, prefix) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(directory, { force: true, recursive: true }));
  return directory;
}

describe('remediation worker outcome reporting', () => {
  it('reports the prompt_written lifecycle recorded by a dry run', async (t) => {
    const directory = createTestDirectory(t, 'baci-report-dry-run-');
    const result = await runRemediationWorker({
      candidateLoader: async () => [candidate()],
      env: environment(directory),
      logger: { error: () => undefined, log: () => undefined },
      now,
      workerName: 'outcome-report',
    });

    assert.match(result.report.text, /lifecycle=open/);
    assert.match(result.report.text, /priorOutcomes=prompt_written/);
  });

  it('reports the lifecycle recorded after enrichment fails', async (t) => {
    const directory = createTestDirectory(t, 'baci-report-enrich-');
    const result = await runRemediationWorker({
      candidateEnricher: () => {
        throw new Error('enrichment unavailable');
      },
      candidateLoader: async () => [candidate()],
      env: environment(directory, true),
      logger: { error: () => undefined, log: () => undefined },
      now,
      workerName: 'outcome-report',
    });

    assert.match(result.report.text, /lifecycle=open/);
    assert.match(
      result.report.text,
      /priorOutcomes=candidate_enrichment_failed/
    );
  });

  it('reports the lifecycle recorded after autofix fails', async (t) => {
    const directory = createTestDirectory(t, 'baci-report-autofix-');
    const result = await runRemediationWorker({
      autofixRunner: () => {
        throw new Error('Codex unavailable');
      },
      candidateLoader: async () => [candidate()],
      env: environment(directory, true),
      logger: { error: () => undefined, log: () => undefined },
      now,
      workerName: 'outcome-report',
    });

    assert.match(result.report.text, /lifecycle=open/);
    assert.match(result.report.text, /priorOutcomes=autofix_failed/);
  });
});
