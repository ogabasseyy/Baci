import { redactCodexOutput } from './remediation-codex-output.mjs';

const CATEGORIES = new Set([
  'sentry_issue',
  'unknown_error',
  'vercel_http_5xx',
  'vercel_runtime_exception',
  'vercel_timeout',
]);

const isIsoDate = (value) =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));
const isSafeSentryIdentity = (value) => /^[A-Za-z0-9._-]+$/.test(value);
const SAFE_VERCEL_ROUTE_SEGMENTS = new Set([
  'api',
  'checkout',
  'health',
  'orders',
  'products',
]);
const MAX_VERCEL_ROUTE_LENGTH = 240;
const safeVercelId = (value, prefix) => {
  const id = String(value || '').trim();
  return new RegExp(`^${prefix}_[A-Za-z0-9_-]{1,80}$`).test(id) ? id : '';
};
const redactCompactPhone = (value) =>
  value.replace(/(?<!\d)\d{10,19}(?!\d)/g, '[REDACTED_PHONE]');

function canonicalVercelRoute(value) {
  const route = String(value || '').split(/[?#]/, 1)[0];
  if (!route.startsWith('/')) return '';
  const segments = route.split('/').filter(Boolean);
  const canonicalRoute = `/${segments
    .map((segment) =>
      SAFE_VERCEL_ROUTE_SEGMENTS.has(segment.toLowerCase())
        ? segment.toLowerCase()
        : ':param'
    )
    .join('/')}`;
  return canonicalRoute.length <= MAX_VERCEL_ROUTE_LENGTH ? canonicalRoute : '';
}

export function createRemediationCaseCandidateNormalizer() {
  function sanitize(value, length) {
    return redactCodexOutput(String(value || ''))
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, length);
  }

  function sanitizeSentryIdentity(value, length) {
    const identity = String(value || '')
      .trim()
      .slice(0, length);
    return isSafeSentryIdentity(identity) ? identity : '';
  }

  function sanitizeHumanText(value, length) {
    return redactCompactPhone(sanitize(value, length)).slice(0, length);
  }

  function sourceFor(candidate) {
    const source = sanitize(candidate?.source || candidate?.sample?.source, 40);
    return source === 'sentry' || source === 'vercel' ? source : 'unknown';
  }

  function categoryFor(candidate, source) {
    const category = sanitize(candidate?.category, 80);
    if (CATEGORIES.has(category)) return category;
    if (source === 'sentry') return 'sentry_issue';
    return source === 'vercel' ? 'vercel_runtime_exception' : 'unknown_error';
  }

  function sampleFor(candidate, source) {
    const sample = candidate?.sample || {};
    if (source === 'vercel') {
      const fields = { errorClass: 120, statusCode: 12 };
      const normalized = { source };
      const route = canonicalVercelRoute(sample.route);
      if (route) normalized.route = route;
      const deploymentId = safeVercelId(sample.deploymentId, 'dpl');
      if (deploymentId) normalized.deploymentId = deploymentId;
      const requestId = safeVercelId(sample.requestId, 'req');
      if (requestId) normalized.requestId = requestId;
      for (const [field, length] of Object.entries(fields)) {
        const value = sanitize(sample[field], length);
        if (value) normalized[field] = value;
      }
      return normalized;
    }
    const fields = {
      appState: 40,
      deploymentId: 120,
      device: 120,
      deviceClass: 40,
      eventSource: 80,
      issueId: 120,
      mechanism: 120,
      message: 1_000,
      organization: 120,
      os: 120,
      platform: 40,
      project: 120,
      release: 120,
      requestId: 120,
      route: 240,
    };
    const normalized = { source };
    for (const [field, length] of Object.entries(fields)) {
      const value =
        source === 'sentry' &&
        ['issueId', 'organization', 'project'].includes(field)
          ? sanitizeSentryIdentity(sample[field], length)
          : ['message', 'route'].includes(field)
            ? sanitizeHumanText(
                field === 'route'
                  ? String(sample[field] || '').split(/[?#]/, 1)[0]
                  : sample[field],
                length
              )
            : sanitize(sample[field], length);
      if (value) normalized[field] = value;
    }
    if (Array.isArray(sample.stackSummary)) {
      normalized.stackSummary = sample.stackSummary
        .slice(-32)
        .map((value) => sanitize(value, 240))
        .filter(Boolean);
    }
    return normalized;
  }

  function normalize(candidate) {
    const source = sourceFor(candidate);
    const fingerprint = sanitize(candidate?.fingerprint, 120).replace(
      /[^A-Za-z0-9_-]/g,
      ''
    );
    if (!fingerprint) return null;
    const category = categoryFor(candidate, source);
    const occurrences =
      Number.isSafeInteger(candidate?.occurrences) && candidate.occurrences >= 0
        ? candidate.occurrences
        : 0;
    const lastSeen = isIsoDate(candidate?.lastSeen)
      ? new Date(candidate.lastSeen).toISOString()
      : '';
    const firstSeen = isIsoDate(candidate?.firstSeen)
      ? new Date(candidate.firstSeen).toISOString()
      : lastSeen;
    return {
      caseKey: `${source}:${category}:${fingerprint}`,
      category,
      fingerprint,
      firstSeen,
      lastSeen,
      observationMarker: lastSeen || `occurrences:${occurrences}`,
      occurrences,
      sample: sampleFor(candidate, source),
      source,
    };
  }

  function normalizeAll(candidates) {
    const byCase = new Map();
    for (const rawCandidate of candidates) {
      const candidate = normalize(rawCandidate);
      if (!candidate) continue;
      const existing = byCase.get(candidate.caseKey);
      if (
        !existing ||
        candidate.lastSeen > existing.lastSeen ||
        (candidate.lastSeen === existing.lastSeen &&
          (candidate.occurrences > existing.occurrences ||
            (candidate.occurrences === existing.occurrences &&
              (candidate.firstSeen < existing.firstSeen ||
                (candidate.firstSeen === existing.firstSeen &&
                  JSON.stringify(candidate) < JSON.stringify(existing))))))
      ) {
        byCase.set(candidate.caseKey, candidate);
      }
    }
    return [...byCase.values()];
  }

  return { normalize, normalizeAll, sanitize };
}
