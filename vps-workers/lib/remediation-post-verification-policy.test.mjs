import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkVerifiedRemediationChanges } from './remediation-post-verification-policy.mjs';

function check(status) {
  const calls = [];
  const result = checkVerifiedRemediationChanges({
    runChecked: (...args) => {
      calls.push(args);
      return status;
    },
    worktreeGitCommandOptions: { cwd: '/worktree' },
  });
  return { calls, result };
}

describe('checkVerifiedRemediationChanges', () => {
  it('returns no_changes when the worktree is clean', () => {
    const { calls, result } = check('');
    assert.deepEqual(result, { type: 'no_changes' });
    assert.deepEqual(calls[0][1], ['status', '--porcelain=v1', '-z', '-uall']);
  });

  it('allows an ordinary application change', () => {
    assert.deepEqual(check(' M apps/web/src/components/cart.tsx\0').result, {
      changedFiles: ['apps/web/src/components/cart.tsx'],
      type: 'allowed',
    });
  });

  it('blocks protected changes after verification', () => {
    const { result } = check('?? .github/workflows/evil.yml\0');
    assert.equal(result.type, 'policy_blocked');
    assert.deepEqual(result.changedFiles, ['.github/workflows/evil.yml']);
    assert.match(result.reasons.join(' '), /protected path touched/);
  });

  it('blocks protected paths containing tabs without decoding quoted paths', () => {
    const { result } = check('?? .github/workflows/evil\t.yml\0');
    assert.equal(result.type, 'policy_blocked');
    assert.deepEqual(result.changedFiles, ['.github/workflows/evil\t.yml']);
  });
});
