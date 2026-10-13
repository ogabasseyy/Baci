import { createHash } from 'node:crypto';

const PAGE_SIZE = 100;
const HARD_MAXIMUM_PAGES = 10;

const boundedString = (value, length) =>
  typeof value === 'string' ? value.trim().slice(0, length) : '';

const positiveInteger = (value, fallback) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const safeProjectId = (value) => {
  const projectId = boundedString(value, 30);
  return /^[1-9]\d{0,28}$/.test(projectId) ? projectId : '';
};

const safeIssueId = (value) => {
  const issueId = boundedString(value, 120);
  return /^[A-Za-z0-9_-]+$/.test(issueId) ? issueId : '';
};

const safeTimestamp = (value) => {
  const timestamp = boundedString(value, 80);
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(timestamp)
    ? timestamp
    : '';
};

const activeIssue = (issue) =>
  ['active', 'open', 'unresolved'].includes(
    boundedString(issue?.status, 40).toLowerCase()
  );

function requiredConfiguration(env) {
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

  let baseUrl;
  try {
    baseUrl = new URL(host);
  } catch {
    throw new Error('POSTHOG_REMEDIATION_HOST must be an HTTPS URL');
  }
  if (baseUrl.protocol !== 'https:' || baseUrl.username || baseUrl.password) {
    throw new Error('POSTHOG_REMEDIATION_HOST must be an HTTPS URL');
  }

  return { baseUrl, projectId, token };
}

function selectCandidates(issues, env, projectId) {
  const minimum = positiveInteger(env.BACI_REMEDIATION_MIN_OCCURRENCES, 2);
  return issues.flatMap((issue) => {
    const issueId = safeIssueId(issue?.id);
    const occurrences = positiveInteger(issue?.aggregations?.occurrences, 0);
    if (!issueId || !activeIssue(issue) || occurrences < minimum) {
      return [];
    }

    return [
      {
        category: 'posthog_issue',
        fingerprint: createHash('sha256')
          .update(`posthog:${projectId}:${issueId}`)
          .digest('hex')
          .slice(0, 16),
        firstSeen: safeTimestamp(issue?.first_seen ?? issue?.firstSeen),
        lastSeen: safeTimestamp(issue?.last_seen ?? issue?.lastSeen),
        occurrences,
        sample: {
          issueId,
          message: 'PostHog error tracking issue',
          route: '(redacted PostHog location)',
          source: 'posthog',
        },
      },
    ];
  });
}

export async function fetchPostHogRemediationCandidates({
  env = process.env,
  fetchFn = fetch,
} = {}) {
  const { baseUrl, projectId, token } = requiredConfiguration(env);
  const maximumPages = Math.min(
    positiveInteger(env.BACI_POSTHOG_REMEDIATION_MAX_PAGES, 1),
    HARD_MAXIMUM_PAGES
  );
  const issues = [];
  let offset = 0;
  for (let page = 0; page < maximumPages; page += 1) {
    const endpoint = new URL(
      `/api/projects/${encodeURIComponent(projectId)}/error_tracking/query/issues/`,
      baseUrl
    );
    const response = await fetchFn(endpoint, {
      body: JSON.stringify({
        filterTestAccounts: true,
        limit: PAGE_SIZE,
        offset,
        orderBy: 'occurrences',
        orderDirection: 'DESC',
        status: 'active',
        volumeResolution: 0,
      }),
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      const scopeHint =
        response.status === 401 || response.status === 403
          ? '; POSTHOG_REMEDIATION_PERSONAL_API_KEY requires error_tracking:read'
          : '';
      throw new Error(
        `PostHog error-tracking issues request failed with HTTP ${response.status}${scopeHint}`
      );
    }

    const payload = await response.json();
    if (
      !payload ||
      typeof payload !== 'object' ||
      !Array.isArray(payload.results)
    ) {
      throw new Error(
        'PostHog error-tracking issues response was not paginated'
      );
    }
    if (typeof payload.hasMore !== 'boolean') {
      throw new Error('PostHog error-tracking issues response omitted hasMore');
    }
    issues.push(...payload.results);

    if (!payload.hasMore) {
      return selectCandidates(issues, env, projectId);
    }

    const nextOffset = Number(payload.nextOffset);
    if (!Number.isSafeInteger(nextOffset) || nextOffset <= offset) {
      throw new Error(
        'PostHog error-tracking issues response returned an unsafe nextOffset'
      );
    }
    offset = nextOffset;
  }

  throw new Error(
    `PostHog error-tracking issue pagination exceeded ${maximumPages} pages; raise BACI_POSTHOG_REMEDIATION_MAX_PAGES to avoid a measurement gap`
  );
}
