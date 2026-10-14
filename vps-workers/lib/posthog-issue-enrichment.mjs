import {
  OCCURRENCE_WINDOW,
  requiredConfiguration,
  safeIssueId,
} from './posthog-remediation-config.mjs';
import { redactCodexOutput } from './remediation-codex-output.mjs';

const boundedString = (value, length) =>
  typeof value === 'string' ? value.trim().slice(0, length) : '';

// Redaction runs before character filtering: stripping punctuation first
// would break email and secret patterns into unmatchable fragments.
const safeTechnicalValue = (value, length) =>
  boundedString(redactCodexOutput(value), length)
    .replace(/[^A-Za-z0-9_$.:<>/ +()-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const framePath = (source) => {
  const text = String(source || '').split(/[?#]/, 1)[0];
  if (!text.includes('://')) return text;
  // Absolute URLs may carry userinfo credentials: keep only the path so
  // neither credentials nor host flow into prompts and reports.
  try {
    return new URL(text).pathname || '';
  } catch {
    return '';
  }
};

const frameCoordinate = (frame) => {
  if (!frame || typeof frame !== 'object') return '';
  // Drop URL query/fragment metadata before sanitizing: arbitrary keys and
  // values are user data, not repository coordinates.
  const source = framePath(frame.source);
  const parts = [
    safeTechnicalValue(source, 160),
    safeTechnicalValue(frame.function, 120),
  ].filter(Boolean);
  if (parts.length === 0) return '';
  const line = Number(frame.line);
  const coordinate =
    parts.join(' :: ') + (Number.isSafeInteger(line) && line > 0 ? `:${line}` : '');
  return coordinate.slice(0, 240);
};

const safeReleaseVersion = (value) => {
  const version = boundedString(value, 120);
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(version)) return '';
  // Dotted versions and tags pass; commit SHAs must contain a hex letter
  // so pure digit runs (phone-shaped) and bare names are dropped.
  if (version.includes('.')) return version;
  if (/^[0-9a-fA-F]{7,40}$/.test(version) && /[a-fA-F]/.test(version)) {
    return version;
  }
  return '';
};

export async function enrichPostHogRemediationCandidate({
  candidate,
  env = process.env,
  fetchFn = fetch,
}) {
  const { baseUrl, projectId, token } = requiredConfiguration(env);
  const issueId = safeIssueId(candidate?.sample?.issueId);
  if (!issueId) {
    throw new Error('PostHog enrichment requires a safe issue ID');
  }

  const endpoint = new URL(
    `/api/projects/${encodeURIComponent(projectId)}/error_tracking/query/issue/`,
    baseUrl
  );
  const response = await fetchFn(endpoint, {
    body: JSON.stringify({
      dateRange: { date_from: OCCURRENCE_WINDOW },
      filterTestAccounts: true,
      issueId,
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
      `PostHog error-tracking issue request failed with HTTP ${response.status}${scopeHint}`
    );
  }

  let detail;
  try {
    detail = await response.json();
  } catch {
    throw new Error('PostHog error-tracking issue response was invalid JSON');
  }
  if (!detail || typeof detail !== 'object') {
    throw new Error('PostHog error-tracking issue response was malformed');
  }

  const coordinate = frameCoordinate(detail.top_in_app_frame);
  const release = safeReleaseVersion(detail.latest_release?.version);
  return {
    ...candidate,
    sample: {
      ...candidate.sample,
      ...(coordinate ? { route: coordinate } : {}),
      ...(release ? { release } : {}),
    },
  };
}
