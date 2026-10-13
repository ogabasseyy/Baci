import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertCodexExecutionUsable,
  redactCodexOutput,
} from './remediation-codex-output.mjs';

describe('Codex remediation output', () => {
  it('rejects the VPS bubblewrap failure instead of treating it as no changes', () => {
    assert.throws(
      () =>
        assertCodexExecutionUsable(
          'Blocked: bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted'
        ),
      /sandbox failed before repository inspection/
    );
  });

  it('rejects the legacy Landlock permission-profile failure', () => {
    assert.throws(
      () =>
        assertCodexExecutionUsable(
          'permission profiles requiring direct runtime enforcement are incompatible with --use-legacy-landlock'
        ),
      /sandbox failed before repository inspection/
    );
  });

  it('rejects a quota failure reported after a long banner', () => {
    assert.throws(
      () =>
        assertCodexExecutionUsable({
          status: 1,
          stderr:
            'Codex execution banner\n'.repeat(300) +
            'You have reached your Codex usage limits for code reviews.',
          stdout: '',
        }),
      /quota_or_usage_limit/
    );
  });

  it('redacts bearer credentials while preserving a quota failure tail', () => {
    assert.throws(
      () =>
        assertCodexExecutionUsable({
          status: 1,
          stderr:
            'Authorization: Bearer baci_live_abcdefghijklmnopqrstuvwxyz012345\n' +
            'You have reached your Codex usage limits for code reviews.',
          stdout: '',
        }),
      (error) => {
        assert.match(error.message, /quota_or_usage_limit/);
        assert.match(
          error.message,
          /You have reached your Codex usage limits for code reviews\./
        );
        assert.doesNotMatch(
          error.message,
          /baci_live_abcdefghijklmnopqrstuvwxyz012345/
        );
        return true;
      }
    );
  });

  it('redacts a bearer credential that crosses the output tail boundary', () => {
    const token = `baci_live_${'a'.repeat(2_500)}`;
    assert.throws(
      () =>
        assertCodexExecutionUsable({
          status: 1,
          stderr: `Authorization: Bearer ${token}`,
          stdout: '',
        }),
      (error) => {
        assert.equal(error.message.includes(token.slice(-100)), false);
        return true;
      }
    );
  });

  it('rejects an execution terminated by a signal as a process failure', () => {
    assert.throws(
      () =>
        assertCodexExecutionUsable({
          signal: 'SIGKILL',
          status: null,
          stderr: '',
          stdout: '',
        }),
      /process_failure.*SIGKILL/
    );
  });

  it('redacts Basic authorization and cookie headers without hiding the usage limit', () => {
    assert.throws(
      () =>
        assertCodexExecutionUsable({
          status: 1,
          stderr:
            'Authorization: Basic dXNlcjpzdXBlcnNlY3JldA==\n' +
            'Set-Cookie: session=very_secret_cookie_abcdef123456; HttpOnly\n' +
            'Codex usage limit reached',
          stdout: '',
        }),
      (error) => {
        assert.match(error.message, /Codex usage limit reached/);
        assert.doesNotMatch(error.message, /dXNlcjpzdXBlcnNlY3JldA==/);
        assert.doesNotMatch(error.message, /very_secret_cookie_abcdef123456/);
        return true;
      }
    );
  });

  it('redacts emails and explicit phone formats while retaining safe numeric IDs', () => {
    const output = redactCodexOutput(
      'customer alice@example.com called +234 803 123 4567, 08031234567, and sentry 8031234567 after deployment dpl_123 status 500 with 3 attempts'
    );

    assert.doesNotMatch(output, /alice@example\.com/);
    assert.doesNotMatch(output, /234 803 123 4567/);
    assert.doesNotMatch(output, /08031234567/);
    assert.match(output, /sentry 8031234567/);
    assert.match(output, /deployment dpl_123/);
    assert.match(output, /status 500 with 3 attempts/);
    assert.match(output, /attempts/);
  });

  it('rejects a successful process without a terminal completed event', () => {
    assert.throws(
      () =>
        assertCodexExecutionUsable({
          status: 0,
          stdout: '{"type":"turn.started"}\n',
          stderr: '',
        }),
      /turn.completed/
    );
  });

  it('rejects a terminal failed JSONL event', () => {
    assert.throws(
      () =>
        assertCodexExecutionUsable({
          status: 0,
          stdout:
            '{"type":"turn.started"}\n{"type":"turn.failed","error":{"message":"toolchain exploded"}}\n',
          stderr: '',
        }),
      /turn.failed/
    );
  });

  it('rejects a malformed nonblank JSONL line', () => {
    assert.throws(
      () =>
        assertCodexExecutionUsable({
          status: 0,
          stdout:
            '{"type":"turn.started"}\nnot-json\n{"type":"turn.completed"}\n',
          stderr: '',
        }),
      /invalid JSONL at line 2/
    );
  });

  it('rejects a protocol event after terminal completion', () => {
    assert.throws(
      () =>
        assertCodexExecutionUsable({
          status: 0,
          stdout:
            '{"type":"turn.completed"}\n{"type":"item.completed","item":{"text":"late"}}\n',
          stderr: '',
        }),
      /final protocol event must be turn.completed/
    );
  });

  it('labels an unavailable Codex toolchain explicitly', () => {
    assert.throws(
      () =>
        assertCodexExecutionUsable({
          status: 0,
          stdout:
            '{"type":"turn.failed","error":{"message":"Codex toolchain unavailable"}}\n',
          stderr: '',
        }),
      /toolchain_failure/
    );
  });

  it('labels an authentication failure explicitly', () => {
    assert.throws(
      () =>
        assertCodexExecutionUsable({
          status: 0,
          stdout:
            '{"type":"error","error":{"message":"not authenticated with Codex"}}\n',
          stderr: '',
        }),
      /authentication_failure/
    );
  });

  it('accepts a successful terminal completed JSONL event', () => {
    assert.doesNotThrow(() =>
      assertCodexExecutionUsable({
        status: 0,
        stdout:
          '{"type":"turn.started"}\n{"type":"turn.completed","usage":{"input_tokens":1}}\n',
        stderr: '',
      })
    );
  });
});
