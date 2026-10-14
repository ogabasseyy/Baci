import { isBuiltin } from 'node:module';
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

// Source coordinates above eight digits are implausible as line numbers
// and overlap phone-shaped identifiers, so they are dropped from the
// route instead of being exported to the prompt.
const MAX_FRAME_LINE = 99_999_999;

// Bundler sourcemap schemes whose URL pathnames are repository structure,
// not deployment locations: their paths are preserved like relative paths.
const VIRTUAL_SOURCE_SCHEMES = new Set([
  'metro',
  'turbopack',
  'vite',
  'webpack',
  'webpack-internal',
]);

// Filesystem roots proving a URL pathname is an absolute local path rather
// than namespace-relative structure: virtual schemes around these still
// expose usernames and customer directories.
const ABSOLUTE_URL_PATH_ROOTS = new Set([
  'etc',
  'home',
  'library',
  'mnt',
  'opt',
  'private',
  'root',
  'srv',
  'system',
  'tmp',
  'usr',
  'users',
  'var',
]);

const isAbsoluteLocalUrlPath = (pathname) => {
  // A leading double slash is a UNC marker, not namespace structure.
  if (pathname.startsWith('//')) return true;
  const segments = pathname
    .split('/')
    .filter((segment) => segment && segment !== '.');
  if (segments.length === 0) return false;
  const [root] = segments;
  if (/^[A-Za-z]:$/.test(root)) return true;
  return ABSOLUTE_URL_PATH_ROOTS.has(root.toLowerCase());
};

const lastSegment = (value) => {
  const segments = value.split(/[\\/]/).filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : '';
};

const assembleRelativePath = (value) => {
  const segments = value.split(/[\\/]/).filter(Boolean);
  if (segments.includes('..')) return lastSegment(value);
  return segments.filter((segment) => segment !== '.').join('/');
};

const framePath = (source) => {
  const text = String(source || '');
  // Decode to a bounded fixed point FIRST so encoded schemes, roots,
  // delimiters, and traversal markers cannot smuggle metadata past
  // classification: single and double encoding resolve, while anything
  // still changing after three rounds — or malformed at any round —
  // fails closed.
  let decoded = text;
  try {
    for (let round = 0; round < 3; round += 1) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
      if (round === 2) return '';
    }
  } catch {
    return '';
  }
  // Query and fragment metadata are user data, never coordinates.
  // Surrounding whitespace is trimmed so padded absolute paths and URIs
  // cannot dodge the shape checks below.
  const bare = decoded.split(/[?#]/, 1)[0].trim();
  // Drive-letter and UNC paths are absolute local paths, not URIs:
  // usernames and customer directories reduce to the basename.
  if (/^[A-Za-z]:[\\/]/.test(bare) || bare.startsWith('\\\\')) {
    return lastSegment(bare);
  }
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(bare)?.[1]?.toLowerCase();
  if (scheme) {
    if (scheme === 'node') {
      // Only genuine builtin specifiers — including subpaths like
      // node:test/reporters — are coordinates. The runtime predicate
      // rejects arbitrary provider text, traversal, and empty suffixes.
      if (!isBuiltin(bare)) return '';
      return bare;
    }
    if (scheme === 'http' || scheme === 'https' || scheme === 'file') {
      // Deployment and file URLs may carry userinfo credentials: keep
      // only the pathname basename so neither credentials nor host flow
      // into prompts and reports.
      try {
        return lastSegment(new URL(bare).pathname || '');
      } catch {
        return '';
      }
    }
    if (VIRTUAL_SOURCE_SCHEMES.has(scheme)) {
      let pathname = '';
      try {
        pathname = new URL(bare).pathname || '';
      } catch {
        return '';
      }
      // Virtual schemes around absolute build paths still expose local
      // directories: basename only. Namespace-relative virtual paths are
      // repository structure and preserved like relative paths.
      if (isAbsoluteLocalUrlPath(pathname)) return lastSegment(pathname);
      return assembleRelativePath(pathname);
    }
    // Blob, data, javascript, and custom schemes are inline content or
    // opaque identifiers, never source coordinates: reject them.
    return '';
  }
  // POSIX-absolute paths reduce to the basename like other absolute
  // shapes; the rest is repository-relative and preserved.
  if (bare.startsWith('/')) return lastSegment(bare);
  return assembleRelativePath(bare);
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
  const plausibleLine =
    Number.isSafeInteger(line) && line > 0 && line <= MAX_FRAME_LINE;
  const coordinate = source + (plausibleLine ? `:${line}` : '');
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
  // Hexadecimal commit identifiers are never accepted: PostHog sends the
  // release as a free-form string, so even full-length SHAs are
  // indistinguishable from key material and cannot be verified against
  // the repository here. Only canonical semver cores are exported.
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
