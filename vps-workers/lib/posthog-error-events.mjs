import { createHash } from 'node:crypto';

const PAGE_SIZE = 100;
const HARD_MAXIMUM_PAGES = 10;
// Occurrence counts are measured over this trailing window so the repeat
// threshold does not depend on the server's default date_from.
export const OCCURRENCE_WINDOW = '-7d';

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

export const safeIssueId = (value) => {
  const issueId = boundedString(value, 120);
  return /^[A-Za-z0-9_-]+$/.test(issueId) ? issueId : '';
};

const safeTimestamp = (value) => {
  const timestamp = boundedString(value, 80);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/.test(
      timestamp
    )
  ) {
    return '';
  }
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
};

const activeIssue = (issue) =>
  ['active', 'open', 'unresolved'].includes(
    boundedString(issue?.status, 40).toLowerCase()
  );

// Well-known runtime exception types. Only these pass through verbatim;
// any other leading token falls back to fixed buckets below, since issue
// names are provider-controlled and can contain personal data.
const KNOWN_EXCEPTION_TYPES = new Set([
  'AbortError',
  'AggregateError',
  'AssertionError',
  'AttributeError',
  'AxiosError',
  'ChunkLoadError',
  'DOMException',
  'Error',
  'EvalError',
  'FirebaseError',
  'IOError',
  'IllegalArgumentException',
  'IllegalStateException',
  'ImportError',
  'IndexError',
  'KeyError',
  'NetworkError',
  'NotFoundError',
  'NullPointerException',
  'RangeError',
  'ReferenceError',
  'RuntimeError',
  'SQLException',
  'SyntaxError',
  'TimeoutError',
  'TypeError',
  'URIError',
  'ValidationError',
  'ValueError',
  'ZodError',
]);

// Derives a bounded triage label from the provider issue name without
// copying provider text: either an allowlisted exception type or a fixed
// keyword bucket.
const classifyPostHogIssueName = (value) => {
  const name = boundedString(value, 240);
  const leadingToken = name.split(/[\s:({\[]/, 1)[0] ?? '';
  if (KNOWN_EXCEPTION_TYPES.has(leadingToken)) {
    return leadingToken;
  }
  if (/\bcrash\b|fatal|application not responding|\banr\b/i.test(name)) {
    return 'Native crash';
  }
  if (/out of memory|heap|allocation failure/i.test(name)) {
    return 'Out of memory';
  }
  if (/timed? ?out|deadline exceeded|ETIMEDOUT/i.test(name)) {
    return 'Timeout';
  }
  if (/network|fetch failed|ECONN|ENOTFOUND|socket hang up/i.test(name)) {
    return 'Network failure';
  }
  if (/\bnull\b|\bundefined\b|cannot read propert/i.test(name)) {
    return 'Null reference';
  }
  return 'PostHog error tracking issue';
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

function selectCandidates(issues, env, projectId) {
  const minimum = positiveInteger(env.BACI_REMEDIATION_MIN_OCCURRENCES, 2);
  return issues.flatMap((issue) => {
    const issueId = safeIssueId(issue?.id);
    // The provider types occurrences as a float: judge eligibility on the
    // raw finite count, then floor for integer-only downstream storage.
    const observedOccurrences = Number(issue?.aggregations?.occurrences);
    if (
      !issueId ||
      !activeIssue(issue) ||
      !Number.isFinite(observedOccurrences) ||
      observedOccurrences < minimum
    ) {
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
        occurrences: Math.floor(observedOccurrences),
        sample: {
          issueId,
          message: classifyPostHogIssueName(issue?.name),
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
    positiveInteger(env.BACI_POSTHOG_REMEDIATION_MAX_PAGES, 10),
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
        dateRange: { date_from: OCCURRENCE_WINDOW },
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

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error(
        'PostHog error-tracking issues response was invalid JSON'
      );
    }
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
    maximumPages >= HARD_MAXIMUM_PAGES
      ? `PostHog error-tracking issue pagination exceeded the fixed ${HARD_MAXIMUM_PAGES}-page hard cap; resolve or mute active issues to fit the cap, or raise the cap in code`
      : `PostHog error-tracking issue pagination exceeded ${maximumPages} pages; raise BACI_POSTHOG_REMEDIATION_MAX_PAGES to avoid a measurement gap`
  );
}
