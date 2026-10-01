import { createHash } from 'node:crypto';

const boundedString = (value, length) =>
  typeof value === 'string' ? value.trim().slice(0, length) : '';

const positiveInteger = (value, fallback) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const nextPageFromLink = (linkHeader, currentUrl) => {
  if (!linkHeader) return null;

  for (const part of linkHeader.split(',')) {
    if (!/\brel="?next"?/i.test(part) || !/\bresults="?true"?/i.test(part)) {
      continue;
    }
    const match = part.match(/<([^>]+)>/);
    if (!match) continue;

    const nextUrl = new URL(match[1], currentUrl);
    if (
      nextUrl.origin !== currentUrl.origin ||
      nextUrl.pathname !== currentUrl.pathname
    ) {
      throw new Error('Sentry pagination returned an unsafe next-page URL');
    }
    return nextUrl;
  }

  return null;
};

const classifyIssueTitle = (value) => {
  const title = boundedString(value, 1_000);
  if (/application not responding|\banr\b/i.test(title)) {
    return 'Application Not Responding';
  }
  if (/native crash|fatal exception|signal \d+/i.test(title)) {
    return 'Native crash';
  }
  return 'Sentry mobile issue';
};

const classifyCulprit = (value) => {
  const culprit = boundedString(value, 240);
  if (/\bMainActivity\b/.test(culprit)) return 'MainActivity';
  if (/\bMainApplication\b/.test(culprit)) return 'MainApplication';
  if (/com\.ogabassey\.store/.test(culprit)) return 'com.ogabassey.store';
  return '';
};

const sentryBaseUrl = (env) => {
  const value = boundedString(env.SENTRY_URL, 500) || 'https://sentry.io/';
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('SENTRY_URL must be a valid https URL');
  }
  if (url.protocol !== 'https:') {
    throw new Error('SENTRY_URL must use https');
  }
  return url;
};

const safeTechnicalValue = (value, length) =>
  boundedString(value, length)
    .replace(/[^A-Za-z0-9_$.:<>/ +()-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const tagValue = (event, key) =>
  boundedString(
    (Array.isArray(event?.tags) ? event.tags : []).find(
      (tag) => tag?.key === key
    )?.value,
    160
  );

const eventFrames = (event) => {
  const frames = [];
  for (const entry of Array.isArray(event?.entries) ? event.entries : []) {
    if (entry?.type !== 'exception' && entry?.type !== 'threads') continue;
    for (const value of Array.isArray(entry?.data?.values)
      ? entry.data.values
      : []) {
      if (entry.type === 'threads') {
        const isRelevantThread =
          value?.current ||
          value?.crashed ||
          value?.main ||
          value?.name === 'main';
        if (!isRelevantThread) continue;
      }
      for (const frame of Array.isArray(value?.stacktrace?.frames)
        ? value.stacktrace.frames
        : []) {
        const moduleName = safeTechnicalValue(frame?.module, 160);
        const functionName = safeTechnicalValue(
          frame?.function || frame?.rawFunction,
          180
        );
        const summary = [moduleName, functionName].filter(Boolean).join('.');
        if (summary) frames.push(summary);
      }
    }
  }
  return [...new Set(frames)].slice(-32);
};

const eventMechanism = (event) => {
  for (const entry of Array.isArray(event?.entries) ? event.entries : []) {
    if (entry?.type !== 'exception') continue;
    for (const value of Array.isArray(entry?.data?.values)
      ? entry.data.values
      : []) {
      const mechanism = safeTechnicalValue(value?.mechanism?.type, 120);
      if (mechanism) return mechanism;
    }
  }
  return safeTechnicalValue(tagValue(event, 'mechanism'), 120);
};

const eventAppState = (event) => {
  const foreground = event?.contexts?.app?.in_foreground;
  if (foreground === true) return 'foreground';
  if (foreground === false) return 'background';
  return '';
};

const eventRelease = (event) =>
  boundedString(
    typeof event?.release === 'string'
      ? event.release
      : event?.release?.version || tagValue(event, 'release'),
    120
  );

export async function enrichSentryRemediationCandidate({
  candidate,
  env = process.env,
  fetchFn = fetch,
}) {
  const token = boundedString(env.SENTRY_REMEDIATION_AUTH_TOKEN, 2_000);
  const organization = boundedString(env.SENTRY_ORG, 120);
  const issueId = boundedString(candidate?.sample?.issueId, 120);
  if (!token || !organization || !issueId) {
    throw new Error(
      'Sentry event enrichment requires SENTRY_REMEDIATION_AUTH_TOKEN, SENTRY_ORG, and an issue ID'
    );
  }

  const endpoint = new URL(
    `/api/0/organizations/${encodeURIComponent(organization)}/issues/${encodeURIComponent(issueId)}/events/latest/`,
    sentryBaseUrl(env)
  );
  const response = await fetchFn(endpoint, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const scopeHint =
      response.status === 401 || response.status === 403
        ? '; SENTRY_REMEDIATION_AUTH_TOKEN requires event:read'
        : '';
    throw new Error(
      `Sentry latest-event request failed with HTTP ${response.status}${scopeHint}`
    );
  }

  let event;
  try {
    event = await response.json();
  } catch {
    throw new Error('Sentry latest-event response was invalid JSON');
  }
  const device = safeTechnicalValue(
    event?.contexts?.device?.model || tagValue(event, 'device'),
    120
  );
  const deviceClass = safeTechnicalValue(tagValue(event, 'device.class'), 40);
  const osName = safeTechnicalValue(
    event?.contexts?.os?.name || tagValue(event, 'os'),
    60
  );
  const osVersion = safeTechnicalValue(event?.contexts?.os?.version, 60);

  return {
    ...candidate,
    sample: {
      ...candidate.sample,
      appState: eventAppState(event),
      device,
      deviceClass,
      mechanism: eventMechanism(event),
      os: [osName, osVersion].filter(Boolean).join(' ').slice(0, 120),
      platform: safeTechnicalValue(event?.platform, 40),
      release: eventRelease(event) || candidate.sample.release,
      route:
        classifyCulprit(event?.culprit) ||
        candidate.sample.route ||
        '(redacted native location)',
      stackSummary: eventFrames(event),
    },
  };
}

export async function fetchSentryRemediationCandidates({
  env = process.env,
  fetchFn = fetch,
} = {}) {
  const token = boundedString(env.SENTRY_REMEDIATION_AUTH_TOKEN, 2_000);
  const organization = boundedString(env.SENTRY_ORG, 120);
  const project = boundedString(env.SENTRY_PROJECT, 120);
  if (!token || !organization || !project) {
    throw new Error(
      'SENTRY_REMEDIATION_AUTH_TOKEN (with event:read), SENTRY_ORG, and SENTRY_PROJECT are required'
    );
  }

  const endpoint = new URL(
    `/api/0/projects/${encodeURIComponent(organization)}/${encodeURIComponent(project)}/issues/`,
    sentryBaseUrl(env)
  );
  endpoint.searchParams.set('limit', '100');
  endpoint.searchParams.set('query', 'is:unresolved');
  endpoint.searchParams.set('sort', 'date');

  const maximumPages = Math.min(
    positiveInteger(env.BACI_SENTRY_REMEDIATION_MAX_PAGES, 10),
    50
  );
  const issues = [];
  let pageUrl = endpoint;
  for (let page = 0; page < maximumPages; page += 1) {
    const response = await fetchFn(pageUrl, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      const scopeHint =
        response.status === 401 || response.status === 403
          ? '; SENTRY_REMEDIATION_AUTH_TOKEN requires event:read'
          : '';
      throw new Error(
        `Sentry issues request failed with HTTP ${response.status}${scopeHint}`
      );
    }

    const pageIssues = await response.json();
    if (!Array.isArray(pageIssues)) {
      throw new Error('Sentry issues response was not an array');
    }
    issues.push(...pageIssues);

    const nextPage = nextPageFromLink(response.headers.get('link'), pageUrl);
    if (!nextPage) return selectCandidates(issues, env);
    pageUrl = nextPage;
  }

  throw new Error(
    `Sentry issue pagination exceeded ${maximumPages} pages; raise BACI_SENTRY_REMEDIATION_MAX_PAGES to avoid a measurement gap`
  );
}

const selectCandidates = (issues, env) => {
  const minimum = positiveInteger(env.BACI_REMEDIATION_MIN_OCCURRENCES, 2);
  return issues.flatMap((issue) => {
    const id = boundedString(issue?.id, 120);
    const occurrences = positiveInteger(issue?.count, 0);
    if (!id || occurrences < minimum) {
      return [];
    }

    return [
      {
        category: 'sentry_issue',
        fingerprint: createHash('sha256')
          .update(`sentry:${id}`)
          .digest('hex')
          .slice(0, 16),
        firstSeen: boundedString(issue?.firstSeen, 80),
        lastSeen: boundedString(issue?.lastSeen, 80),
        occurrences,
        sample: {
          issueId: id,
          message: classifyIssueTitle(issue?.title),
          organization: boundedString(env.SENTRY_ORG, 120),
          project: boundedString(env.SENTRY_PROJECT, 120),
          release: boundedString(issue?.lastRelease?.version, 120),
          route:
            classifyCulprit(issue?.culprit) || '(redacted native location)',
          source: 'sentry',
        },
        source: 'sentry',
      },
    ];
  });
};
