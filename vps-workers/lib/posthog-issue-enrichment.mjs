import { readBoundedJson } from './posthog-bounded-json.mjs';
import { posthogQueryContract as posthogQuery } from './posthog-query-contract.mjs';
import { requiredConfiguration } from './posthog-remediation-config.mjs';
import { redactCodexOutput } from './remediation-codex-output.mjs';

const {
  MAX_RESPONSE_BYTES,
  OCCURRENCE_WINDOW,
  boundedString,
  safeIssueId,
} = posthogQuery;

// Redaction runs before character filtering: stripping punctuation first
// would break email and secret patterns into unmatchable fragments.
// Mirrors the normalizer's compact-phone guard: enrichment output feeds
// the prompt directly without passing case normalization again.
const redactCompactPhone = (value) =>
  value.replace(/(?<!\d)\d{10,19}(?!\d)/g, '[REDACTED_PHONE]');

const safeTechnicalValue = (value, length) =>
  boundedString(redactCompactPhone(redactCodexOutput(value)), length)
    .replace(/[^A-Za-z0-9_$.:<>/ +()-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const framePath = (source) => {
  const text = String(source || '');
  let path = text;
  if (text.includes('://')) {
    // Absolute URLs may carry userinfo credentials: keep only the path so
    // neither credentials nor host flow into prompts and reports.
    try {
      path = new URL(text.split(/[?#]/, 1)[0]).pathname || '';
    } catch {
      return '';
    }
  }
  // Decode before stripping delimiters so encoded query/fragment markers
  // cannot smuggle metadata into the basename; decode before redaction so
  // encoded assignments cannot hide from secret patterns. Malformed
  // sequences fail closed.
  try {
    path = decodeURIComponent(path);
  } catch {
    return '';
  }
  // Absolute local paths may embed usernames and customer directories:
  // keep only the basename for every path shape.
  const segments = path.split(/[?#]/, 1)[0].split(/[\\/]/).filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : '';
};

const frameCoordinate = (frame) => {
  if (!frame || typeof frame !== 'object') return '';
  // Drop URL query/fragment metadata before sanitizing: arbitrary keys and
  // values are user data, not repository coordinates.
  const source = safeTechnicalValue(framePath(frame.source), 160);
  if (!source) return '';
  // The function label is omitted: provider frame labels are untrusted and
  // cannot be verified against repository symbols here, while file and
  // line already locate the failing code.
  const line = Number(frame.line);
  const coordinate =
    source + (Number.isSafeInteger(line) && line > 0 ? `:${line}` : '');
  return coordinate.slice(0, 240);
};

const safeReleaseVersion = (value) => {
  const version = boundedString(value, 120);
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(version)) return '';
  // Canonical semver core only; prerelease/build suffixes can carry
  // arbitrary captured text, so they are truncated away.
  const core = /^(v?\d+\.\d+(?:\.\d+)?)(?:[-+][0-9A-Za-z.-]+)?$/.exec(version);
  if (core) {
    // A phone-shaped digit run hiding behind dots is still dropped.
    const digits = core[1].replace(/\D/g, '');
    return digits.length >= 10 && digits.length <= 19 ? '' : core[1];
  }
  // Commit SHAs must contain a hex letter so pure digit runs and bare
  // names are dropped.
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

  const detail = await readBoundedJson(response, {
    label: 'PostHog error-tracking issue response',
    maxBytes: MAX_RESPONSE_BYTES,
  });
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
