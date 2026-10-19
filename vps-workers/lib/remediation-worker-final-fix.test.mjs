import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { buildCodexRemediationPrompt } from './remediation-policy.mjs';
import {
  runRemediationWorker,
  runRemediationWorkerWithGlobalCaseStateLock,
} from './remediation-worker.test-harness.mjs';

function candidate(overrides = {}) {
  return {
    category: 'vercel_runtime_exception',
    fingerprint: 'case-1',
    lastSeen: '2026-08-09T10:00:00.000Z',
    occurrences: 2,
    sample: { errorClass: 'TypeError', route: '/orders', source: 'vercel' },
    source: 'vercel',
    ...overrides,
  };
}

const testNow = () => Date.parse('2026-08-09T10:05:00.000Z');

describe('remediation worker final recovery contracts', () => {
  it('cleans a legacy lifecycle lock after opening a PR under the global lock', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-pr-replay-'));
    const lifecycleLock = join(directory, 'case-state.autofix.json.lock');
    let attempts = 0;
    const env = {
      BACI_REMEDIATION_AUTOFIX_ENABLED: '1',
      BACI_REMEDIATION_OUTPUT_DIR: directory,
    };
    const runner = () => {
      attempts += 1;
      writeFileSync(lifecycleLock, 'hold lifecycle checkpoint');
      return {
        branch: 'codex/fix-case-1',
        prUrl: 'https://github.com/baci/baci/pull/1',
        type: 'pr_opened',
      };
    };

    await runRemediationWorkerWithGlobalCaseStateLock({
      autofixRunner: runner,
      candidateLoader: async () => [candidate()],
      env,
      now: testNow,
      workerName: 'final-fix',
    });
    assert.equal(existsSync(lifecycleLock), false);
    const newer = candidate({
      lastSeen: '2026-08-09T10:02:00.000Z',
      occurrences: 3,
    });
    const result = await runRemediationWorkerWithGlobalCaseStateLock({
      autofixRunner: runner,
      candidateLoader: async () => [newer],
      env,
      now: testNow,
      workerName: 'final-fix',
    });
    const lifecycle = JSON.parse(
      readFileSync(join(directory, 'case-state.autofix.json'), 'utf8')
    );

    assert.equal(attempts, 1);
    assert.equal(
      result.actions.some((action) => action.type === 'pr_opened'),
      false
    );
    assert.equal(
      result.actions.some(
        (action) => action.type === 'active_draft_recurrence'
      ),
      true
    );
    assert.equal(result.candidates[0].draftPr.branch, 'codex/fix-case-1');
    assert.equal(
      lifecycle.cases['vercel:vercel_runtime_exception:case-1'].status,
      'pr_open'
    );
  });

  it('caps dry-run prompts for four Vercel candidates', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-dry-run-cap-'));
    const result = await runRemediationWorker({
      candidateLoader: async () =>
        Array.from({ length: 4 }, (_, index) =>
          candidate({ fingerprint: `case-${index}` })
        ),
      env: {
        BACI_REMEDIATION_MAX_CANDIDATES_PER_RUN: '1',
        BACI_REMEDIATION_OUTPUT_DIR: directory,
      },
      now: testNow,
      workerName: 'final-fix',
    });

    assert.equal(result.candidates.length, 1);
    assert.equal(
      result.actions.filter((action) => action.type === 'prompt_written')
        .length,
      1
    );
    const promptAction = result.actions.find(
      (action) => action.type === 'prompt_written'
    );
    assert.ok(promptAction);
    const prompt = readFileSync(promptAction.path, 'utf8');
    assert.match(prompt, /Research only/);
    assert.doesNotMatch(prompt, /research was completed and accepted/);
  });

  it('rejects journal path collisions before loading candidates', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-journal-collision-'));
    for (const [journalPath, casePath, statePath] of [
      [
        join(directory, 'shared-case.json'),
        join(directory, 'shared-case.json'),
        join(directory, 'state.json'),
      ],
      [
        join(directory, 'shared-state.json'),
        join(directory, 'case.json'),
        join(directory, 'shared-state.json'),
      ],
      [
        join(directory, 'journal.json'),
        join(directory, 'shared-case-state.json'),
        join(directory, 'shared-case-state.json'),
      ],
    ]) {
      let loaded = false;
      await assert.rejects(
        runRemediationWorker({
          candidateLoader: () => {
            loaded = true;
            return [];
          },
          env: {
            BACI_REMEDIATION_CASE_STATE_PATH: casePath,
            BACI_REMEDIATION_OUTPUT_DIR: directory,
            BACI_REMEDIATION_PR_JOURNAL_PATH: journalPath,
            BACI_REMEDIATION_STATE_PATH: statePath,
          },
          workerName: 'final-fix',
        }),
        /paths must differ/
      );
      assert.equal(loaded, false);
    }
  });

  it('migrates only the exact legacy observation and remediates a newer recurrence', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-legacy-handled-'));
    const legacyPath = join(directory, 'handled-state.autofix.json');
    writeFileSync(
      legacyPath,
      JSON.stringify({
        handled: {
          'case-1': {
            observation: '2026-08-09T10:00:00.000Z',
            recordedAt: '2026-08-09T10:01:00.000Z',
          },
        },
        notifications: {},
        reservations: {},
        version: 2,
      })
    );
    const attempts = [];
    await runRemediationWorker({
      autofixRunner: () => {
        attempts.push('first');
        return { type: 'no_changes' };
      },
      candidateLoader: async () => [candidate()],
      env: {
        BACI_REMEDIATION_AUTOFIX_ENABLED: '1',
        BACI_REMEDIATION_OUTPUT_DIR: directory,
      },
      now: testNow,
      workerName: 'final-fix',
    });
    const newer = await runRemediationWorker({
      autofixRunner: () => {
        attempts.push('second');
        return { type: 'no_changes' };
      },
      candidateLoader: async () => [
        candidate({ lastSeen: '2026-08-09T10:03:00.000Z', occurrences: 3 }),
      ],
      env: {
        BACI_REMEDIATION_AUTOFIX_ENABLED: '1',
        BACI_REMEDIATION_OUTPUT_DIR: directory,
      },
      now: testNow,
      workerName: 'final-fix',
    });

    assert.deepEqual(attempts, ['second']);
    assert.equal(
      newer.actions.some(
        (action) => action.type === 'legacy_handled_recurrence'
      ),
      false
    );
  });

  it('adds safe current-case outcome history to retry prompts', () => {
    const prompt = buildCodexRemediationPrompt({
      candidate: candidate({
        draftPr: {
          branch: 'codex/fix-case-1',
          url: 'https://example.test/pr/1',
        },
        history: [
          {
            at: '2026-08-09T10:00:00.000Z',
            detail: 'Alice Okafor at 12 Example Road failed safely',
            type: 'autofix_failed',
          },
        ],
        recurrenceCount: 2,
        status: 'investigating',
      }),
    });

    assert.match(prompt, /"currentLifecycle"/);
    assert.match(prompt, /"autofix_failed"/);
    assert.match(prompt, /"recurrenceCount": 2/);
    assert.doesNotMatch(prompt, /Alice Okafor|12 Example Road/);
  });
});
