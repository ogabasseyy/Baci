import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { assertCodexExecutionUsable } from './remediation-codex-output.mjs';
import { runRemediationWorker } from './remediation-worker.test-harness.mjs';

function createTestDirectory(t, prefix) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(directory, { force: true, recursive: true }));
  return directory;
}

describe('remediation worker reporting privacy', () => {
  it('keeps redacted Codex failures out of logs and email report actions', async (t) => {
    const directory = createTestDirectory(t, 'baci-worker-redaction-');
    const loggedMessages = [];
    const token = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';

    const result = await runRemediationWorker({
      autofixRunner: () =>
        assertCodexExecutionUsable({
          status: 1,
          stderr: `Authorization: Bearer ${token}\nCodex usage limit reached`,
          stdout: '',
        }),
      candidateLoader: async () => [
        {
          fingerprint: 'redaction',
          occurrences: 3,
          sample: { source: 'sentry' },
        },
      ],
      env: {
        BACI_REMEDIATION_AUTOFIX_ENABLED: '1',
        BACI_REMEDIATION_OUTPUT_DIR: directory,
      },
      logger: {
        error: (_message, error) => loggedMessages.push(error.message),
        log: () => undefined,
      },
      workerName: 'test-remediator',
    });

    const failure = result.actions.find(
      (action) => action.type === 'autofix_failed'
    );
    assert.ok(failure);
    assert.doesNotMatch(failure.detail, new RegExp(token));
    assert.match(failure.detail, /\[REDACTED\]/);
    assert.doesNotMatch(result.report.text, new RegExp(token));
    assert.doesNotMatch(loggedMessages[0], new RegExp(token));
  });

  it('persists an email-failure action in the notification retry report', async (t) => {
    const directory = createTestDirectory(t, 'baci-worker-email-failure-');
    const result = await runRemediationWorker({
      candidateLoader: async () => [
        {
          fingerprint: 'email-failure',
          occurrences: 2,
          sample: { source: 'sentry' },
        },
      ],
      env: {
        BACI_REMEDIATION_NOTIFY_EMAILS: 'ops@example.com',
        BACI_REMEDIATION_OUTPUT_DIR: directory,
        ZEPTOMAIL_TOKEN: 'configured-token',
      },
      fetchFn: async () => new Response('unavailable', { status: 503 }),
      logger: { error: () => undefined, log: () => undefined },
      workerName: 'test-remediator',
    });

    assert.match(result.report.text, /email_failed/);
    const state = JSON.parse(
      readFileSync(join(directory, 'handled-state.dry-run.json'), 'utf8')
    );
    const notification = Object.values(state.notifications)[0];
    assert.match(notification.report.text, /email_failed/);
  });

  it('keeps ZeptoMail failure bodies out of worker and job-visible output', async (t) => {
    const directory = createTestDirectory(t, 'baci-worker-email-privacy-');
    const stripeLikeToken = ['sk', 'live', 'abcdefghijklmnopqrstuvwxyz'].join(
      '_'
    );
    const providerBody = `customer@example.test Authorization: Bearer ${stripeLikeToken}`;
    const logged = [];
    const result = await runRemediationWorker({
      candidateLoader: async () => [
        {
          fingerprint: 'email-privacy',
          occurrences: 2,
          sample: { source: 'sentry' },
        },
      ],
      env: {
        BACI_REMEDIATION_NOTIFY_EMAILS: 'ops@example.com',
        BACI_REMEDIATION_OUTPUT_DIR: directory,
        ZEPTOMAIL_TOKEN: 'configured-token',
      },
      fetchFn: async () => new Response(providerBody, { status: 503 }),
      logger: {
        error: (_message, error) => logged.push(error.message),
        log: () => undefined,
      },
      workerName: 'test-remediator',
    });
    const jobOutput = JSON.stringify({
      actions: result.actions,
      candidates: result.candidates.length,
      email: result.email,
      mode: result.mode,
    });

    for (const output of [
      ...logged,
      JSON.stringify(result.actions),
      result.email.error,
      result.report.html,
      result.report.text,
      jobOutput,
    ]) {
      assert.doesNotMatch(output, /customer@example\.test/);
      assert.equal(output.includes(stripeLikeToken), false);
    }
    assert.equal(result.email.error, 'ZeptoMail report failed with HTTP 503');
  });
});
