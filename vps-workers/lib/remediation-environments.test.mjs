import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildRemediationEnvironments } from './remediation-environments.mjs';

describe('remediation subprocess environments', () => {
  it('separates runtime, commit identity, and remote credentials', () => {
    const environments = buildRemediationEnvironments({
      GH_TOKEN: 'github-token',
      GIT_AUTHOR_NAME: 'Baci Remediator',
      PATH: '/usr/bin',
      SENTRY_REMEDIATION_AUTH_TOKEN: 'provider-secret',
    });

    assert.deepEqual(environments.child, { PATH: '/usr/bin' });
    assert.equal(environments.gitIdentity.GIT_AUTHOR_NAME, 'Baci Remediator');
    assert.equal('GH_TOKEN' in environments.gitIdentity, false);
    assert.equal(environments.gitRemote.GH_TOKEN, 'github-token');
    assert.equal(
      Object.values(environments).some(
        (environment) => 'SENTRY_REMEDIATION_AUTH_TOKEN' in environment
      ),
      false
    );
  });
});
