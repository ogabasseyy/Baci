import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildCodexSandboxArgs } from './remediation-codex-sandbox-args.mjs';

describe('remediation Codex sandbox arguments', () => {
  it('uses legacy Landlock for read-only Docker research', () => {
    assert.deepEqual(buildCodexSandboxArgs({ readOnly: true }), [
      '--sandbox',
      'read-only',
      '--enable',
      'use_legacy_landlock',
    ]);
  });

  it('uses the externally bounded bypass for writable Docker implementation', () => {
    assert.deepEqual(buildCodexSandboxArgs({ readOnly: false }), [
      '--dangerously-bypass-approvals-and-sandbox',
    ]);
  });
});
