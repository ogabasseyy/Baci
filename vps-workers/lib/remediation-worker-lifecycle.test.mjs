import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { assertCodexExecutionUsable } from './remediation-codex-output.mjs';
import {
  runRemediationWorker,
  runRemediationWorkerWithGlobalCaseStateLock,
} from './remediation-worker.test-harness.mjs';

function createTestDirectory(t, prefix) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(directory, { force: true, recursive: true }));
  return directory;
}

describe('remediation worker lifecycle', () => {
  it('keeps Cookie and Set-Cookie values out of worker report output', async (t) => {
    const directory = createTestDirectory(t, 'baci-worker-cookie-');
    const cookie = 'session=very_secret_cookie_abcdef123456';
    const setCookie = 'refresh=another_secret_cookie_abcdef123456';
    const result = await runRemediationWorker({
      autofixRunner: () =>
        assertCodexExecutionUsable({
          status: 1,
          stderr: `Cookie: ${cookie}\nSet-Cookie: ${setCookie}\nCodex usage limit reached`,
          stdout: '',
        }),
      candidateLoader: async () => [
        {
          fingerprint: 'cookies',
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

    assert.doesNotMatch(result.report.text, new RegExp(cookie));
    assert.doesNotMatch(result.report.text, new RegExp(setCookie));
    assert.match(result.report.text, /autofix_failed/);
  });

  it('keeps provider cases mode-scoped and does not duplicate an active draft PR', async (t) => {
    const directory = createTestDirectory(t, 'baci-worker-lifecycle-');
    let attempts = 0;
    const now = () => Date.parse('2026-08-01T10:02:00.000Z');
    let observedAt = '2026-08-01T10:00:00.000Z';
    const env = {
      BACI_REMEDIATION_AUTOFIX_ENABLED: '1',
      BACI_REMEDIATION_OUTPUT_DIR: directory,
    };
    const loader = async () => [
      {
        category: 'sentry_issue',
        fingerprint: 'issue-44',
        lastSeen: observedAt,
        occurrences: 2,
        sample: { issueId: '44', source: 'sentry' },
        source: 'sentry',
      },
    ];
    const runner = () => {
      attempts += 1;
      return {
        branch: 'codex/fix-issue-44',
        prUrl: 'https://github.com/baci/baci/pull/44',
        type: 'pr_opened',
      };
    };

    for (const nextObservedAt of [
      observedAt,
      observedAt,
      '2026-08-01T10:01:00.000Z',
    ]) {
      observedAt = nextObservedAt;
      await runRemediationWorker({
        autofixRunner: runner,
        candidateLoader: loader,
        draftPrStatusResolver: () => 'open',
        env,
        now,
        workerName: 'test-remediator',
      });
    }

    const lifecycle = JSON.parse(
      readFileSync(join(directory, 'case-state.autofix.json'), 'utf8')
    );
    const stored = lifecycle.cases['sentry:sentry_issue:issue-44'];
    assert.equal(attempts, 1);
    assert.equal(stored.status, 'pr_open');
    assert.equal(stored.recurrenceCount, 1);
    assert.equal(stored.draftPr.url, 'https://github.com/baci/baci/pull/44');
  });

  it('does not open a second PR when a quiet case has active draft linkage', async (t) => {
    const directory = createTestDirectory(t, 'baci-worker-quiet-draft-');
    let attempts = 0;
    let nowMs = Date.parse('2026-08-01T10:02:00.000Z');
    let observedAt = '2026-08-01T10:00:00.000Z';
    const env = {
      BACI_REMEDIATION_AUTOFIX_ENABLED: '1',
      BACI_REMEDIATION_OUTPUT_DIR: directory,
    };
    const candidateLoader = async () => [
      {
        category: 'sentry_issue',
        fingerprint: 'issue-quiet-draft',
        lastSeen: observedAt,
        occurrences: 2,
        sample: { issueId: 'quiet-draft', source: 'sentry' },
        source: 'sentry',
      },
    ];
    const run = () =>
      runRemediationWorker({
        autofixRunner: () => {
          attempts += 1;
          return {
            branch: 'codex/fix-quiet-draft',
            prUrl: 'https://github.com/baci/baci/pull/45',
            type: 'pr_opened',
          };
        },
        candidateLoader,
        draftPrStatusResolver: () => 'open',
        env,
        now: () => nowMs,
        workerName: 'test-remediator',
      });

    await run();
    nowMs += 7 * 24 * 60 * 60 * 1_000;
    await run();
    observedAt = '2026-08-08T10:03:00.000Z';
    nowMs += 60_000;
    await run();
    assert.equal(attempts, 1);
  });

  it('cleans a legacy lifecycle lock after opening a PR under the global lock', async (t) => {
    const directory = createTestDirectory(t, 'baci-worker-pr-crash-');
    const lifecycleLock = join(directory, 'case-state.autofix.json.lock');
    let attempts = 0;
    const env = {
      BACI_REMEDIATION_AUTOFIX_ENABLED: '1',
      BACI_REMEDIATION_OUTPUT_DIR: directory,
    };
    const runner = () => {
      attempts += 1;
      writeFileSync(lifecycleLock, 'simulate crash before checkpoint');
      return {
        branch: 'codex/fix-crash',
        prUrl: 'https://github.com/baci/baci/pull/46',
        type: 'pr_opened',
      };
    };
    const candidateLoader = async () => [
      {
        category: 'sentry_issue',
        fingerprint: 'issue-crash',
        lastSeen: '2026-08-01T10:00:00.000Z',
        occurrences: 2,
        sample: { issueId: 'crash', source: 'sentry' },
        source: 'sentry',
      },
    ];

    await runRemediationWorkerWithGlobalCaseStateLock({
      autofixRunner: runner,
      candidateLoader,
      env,
      now: () => Date.parse('2026-08-01T10:01:00.000Z'),
      workerName: 'test-remediator',
    });
    assert.equal(existsSync(lifecycleLock), false);
    await runRemediationWorkerWithGlobalCaseStateLock({
      autofixRunner: runner,
      candidateLoader,
      env,
      now: () => Date.parse('2026-08-01T10:17:00.000Z'),
      workerName: 'test-remediator',
    });
    assert.equal(attempts, 1);
  });

  it('rejects identical legacy and lifecycle state paths before loading candidates', async (t) => {
    let loaded = false;
    const outputDir = createTestDirectory(t, 'baci-worker-path-');
    const sharedPath = join(outputDir, 'state.json');
    await assert.rejects(
      runRemediationWorker({
        candidateLoader: () => {
          loaded = true;
          return [];
        },
        env: {
          BACI_REMEDIATION_CASE_STATE_PATH: sharedPath,
          BACI_REMEDIATION_OUTPUT_DIR: outputDir,
          BACI_REMEDIATION_STATE_PATH: sharedPath,
        },
        workerName: 'test-remediator',
      }),
      /must differ/
    );
    assert.equal(loaded, false);
  });
});
