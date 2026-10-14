import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  OCCURRENCE_WINDOW,
  requiredConfiguration,
  safeIssueId,
  safeProjectId,
} from './posthog-remediation-config.mjs';

const environment = {
  POSTHOG_REMEDIATION_HOST: 'https://eu.posthog.com',
  POSTHOG_REMEDIATION_PERSONAL_API_KEY: 'phx_read_only_personal_key',
  POSTHOG_REMEDIATION_PROJECT_ID: '202711',
};

describe('PostHog remediation configuration', () => {
  it('returns a cleaned origin for a complete dedicated configuration', () => {
    const { baseUrl, projectId, token } = requiredConfiguration({
      ...environment,
      POSTHOG_REMEDIATION_HOST: 'https://eu.posthog.com/?debug=1#frag',
    });

    assert.equal(baseUrl.origin, 'https://eu.posthog.com');
    assert.equal(String(baseUrl), 'https://eu.posthog.com/');
    assert.equal(projectId, '202711');
    assert.equal(token, 'phx_read_only_personal_key');
    assert.equal(OCCURRENCE_WINDOW, '-7d');
  });

  it('rejects missing, ingestion-shaped, and non-personal credentials', () => {
    assert.throws(
      () => requiredConfiguration({}),
      /POSTHOG_REMEDIATION_HOST.*POSTHOG_REMEDIATION_PERSONAL_API_KEY.*POSTHOG_REMEDIATION_PROJECT_ID/
    );
    assert.throws(
      () =>
        requiredConfiguration({
          ...environment,
          POSTHOG_REMEDIATION_PERSONAL_API_KEY: 'phc_public_key',
        }),
      /not a project ingestion key/
    );
    assert.throws(
      () =>
        requiredConfiguration({
          ...environment,
          POSTHOG_REMEDIATION_PERSONAL_API_KEY: 'sk-generic-token',
        }),
      /must be a personal API key \(phx_\.\.\.\)/
    );
  });

  it('rejects hosts that are not plain credential-free HTTPS origins', () => {
    for (const host of [
      'http://eu.posthog.com',
      'https://user:pass@eu.posthog.com',
      'https://eu.posthog.com/some/app',
      'not-a-url',
    ]) {
      assert.throws(
        () => requiredConfiguration({ ...environment, POSTHOG_REMEDIATION_HOST: host }),
        /HTTPS URL|must not include a path/,
        host
      );
    }
  });

  it('accepts only numeric project IDs and identifier-shaped issue IDs', () => {
    assert.equal(safeProjectId('202711'), '202711');
    assert.equal(safeProjectId('project-1'), '');
    assert.equal(safeProjectId(''), '');
    assert.equal(safeIssueId('019611e5-abc_DEF-42'), '019611e5-abc_DEF-42');
    assert.equal(safeIssueId('alice@example.com'), '');
    assert.equal(safeIssueId(''), '');
  });
});
