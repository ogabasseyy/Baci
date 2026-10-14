export const boundedString = (value, length) =>
  typeof value === 'string' ? value.trim().slice(0, length) : '';

// Occurrence counts are measured over this trailing window so the repeat
// threshold does not depend on the server's default date_from.
export const OCCURRENCE_WINDOW = '-7d';

export const safeProjectId = (value) => {
  const projectId = boundedString(value, 30);
  return /^[1-9]\d{0,28}$/.test(projectId) ? projectId : '';
};

export const safeIssueId = (value) => {
  const issueId = boundedString(value, 120);
  return /^[A-Za-z0-9_-]+$/.test(issueId) ? issueId : '';
};

export function requiredConfiguration(env) {
  const host = boundedString(env.POSTHOG_REMEDIATION_HOST, 500);
  const token = boundedString(env.POSTHOG_REMEDIATION_PERSONAL_API_KEY, 2_000);
  const projectId = safeProjectId(env.POSTHOG_REMEDIATION_PROJECT_ID);
  if (!host || !token || !projectId) {
    throw new Error(
      'POSTHOG_REMEDIATION_HOST, POSTHOG_REMEDIATION_PERSONAL_API_KEY (with error_tracking:read), and POSTHOG_REMEDIATION_PROJECT_ID are required'
    );
  }
  if (/^phc_/i.test(token)) {
    throw new Error(
      'POSTHOG_REMEDIATION_PERSONAL_API_KEY must be a personal API key, not a project ingestion key'
    );
  }
  if (!/^phx_/.test(token)) {
    throw new Error(
      'POSTHOG_REMEDIATION_PERSONAL_API_KEY must be a personal API key (phx_...) limited to error_tracking:read'
    );
  }

  let baseUrl;
  try {
    baseUrl = new URL(host);
  } catch {
    throw new Error('POSTHOG_REMEDIATION_HOST must be an HTTPS URL');
  }
  if (baseUrl.protocol !== 'https:' || baseUrl.username || baseUrl.password) {
    throw new Error('POSTHOG_REMEDIATION_HOST must be an HTTPS URL');
  }
  // The issues endpoint is built from an absolute path, so a host with a
  // subpath would silently query the origin root instead.
  if (baseUrl.pathname !== '/' && baseUrl.pathname !== '') {
    throw new Error('POSTHOG_REMEDIATION_HOST must not include a path');
  }
  baseUrl.search = '';
  baseUrl.hash = '';

  return { baseUrl, projectId, token };
}
