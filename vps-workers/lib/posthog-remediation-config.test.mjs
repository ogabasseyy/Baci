import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { requiredConfiguration } from './posthog-remediation-config.mjs';

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
        () =>
          requiredConfiguration({
            ...environment,
            POSTHOG_REMEDIATION_HOST: host,
          }),
        /HTTPS URL|must not include a path/,
        host
      );
    }
  });

  it('rejects non-numeric project IDs', () => {
    for (const projectId of ['project-1', '', '0', '0123x']) {
      assert.throws(
        () =>
          requiredConfiguration({
            ...environment,
            POSTHOG_REMEDIATION_PROJECT_ID: projectId,
          }),
        /POSTHOG_REMEDIATION_PROJECT_ID are required/,
        projectId
      );
    }
  });
});
