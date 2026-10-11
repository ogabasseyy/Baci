import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

class ProvenanceError extends Error {}

export function resolveRelease(config, platform) {
  if (platform !== 'android' && platform !== 'ios') {
    throw new ProvenanceError('Expected android or ios');
  }
  const native = config[platform];
  const identifier =
    platform === 'ios' ? native?.bundleIdentifier : native?.package;
  const build = platform === 'ios' ? native?.buildNumber : native?.versionCode;
  if (
    !/^[A-Za-z0-9_.]+$/.test(identifier ?? '') ||
    !/^\d+\.\d+\.\d+$/.test(config.version ?? '') ||
    !/^[1-9]\d*$/.test(String(build ?? ''))
  ) {
    throw new ProvenanceError('Invalid resolved native release identity');
  }
  return `${identifier}@${config.version}+${build}`;
}

export async function attachReleaseProvenance({
  env = process.env,
  release,
  checkoutSha,
  fetchFn = fetch,
}) {
  const sha = env.GITHUB_SHA;
  const token = env.SENTRY_AUTH_TOKEN?.trim();
  const org = env.SENTRY_ORG?.trim();
  const project = env.SENTRY_PROJECT?.trim();
  const repository = env.GITHUB_REPOSITORY;
  if (
    !token ||
    !org ||
    !project ||
    !/^[a-f0-9]{40}$/.test(sha ?? '') ||
    sha !== checkoutSha ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '')
  ) {
    throw new ProvenanceError(
      'Sentry provenance requires credentials and the exact checked-out GitHub SHA'
    );
  }
  const base = new URL(env.SENTRY_URL || 'https://sentry.io/');
  if (base.protocol !== 'https:' || base.username || base.password) {
    throw new ProvenanceError(
      'SENTRY_URL must be an HTTPS origin without credentials'
    );
  }
  const collection = new URL(
    `/api/0/organizations/${encodeURIComponent(org)}/releases/`,
    base
  );
  const endpoint = new URL(`${encodeURIComponent(release)}/`, collection);
  async function request(url, method, body) {
    const response = await fetchFn(url, {
      method,
      redirect: 'error',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15_000),
    });
    if (method === 'GET' && response.status === 404) return null;
    if (!response.ok)
      throw new ProvenanceError(
        `Sentry provenance request failed with HTTP ${response.status}`
      );
    return response.json();
  }
  const existing = await request(endpoint, 'GET');
  // Never guess provenance for an already shipped version or replace another SHA.
  if (
    existing &&
    ((existing.ref && existing.ref !== sha) ||
      (!existing.ref && existing.firstEvent))
  ) {
    throw new ProvenanceError(
      'Existing release provenance conflicts with this build; use a new build number'
    );
  }
  const metadata = {
    ref: sha,
    url: `https://github.com/${repository}/commit/${sha}`,
    commits: [{ id: sha }],
  };
  await request(existing ? endpoint : collection, existing ? 'PUT' : 'POST', {
    ...(!existing
      ? { version: release, projects: [project], dateReleased: null }
      : {}),
    ...metadata,
  });
  const verified = await request(endpoint, 'GET');
  if (verified?.ref !== sha || verified?.lastCommit?.id !== sha) {
    throw new ProvenanceError(
      'Sentry release source association was not verified'
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    const release = resolveRelease(JSON.parse(input), process.argv[2]);
    const checkoutSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
    await attachReleaseProvenance({ release, checkoutSha });
    console.log(`Verified Sentry source association for ${release}`);
  } catch (error) {
    // Do not echo provider bodies, Expo config, credentials, or subprocess errors.
    console.error(
      error instanceof ProvenanceError
        ? error.message
        : 'Sentry release provenance failed; verify configuration, permissions and build identity.'
    );
    process.exitCode = 1;
  }
}
