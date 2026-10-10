// Canonical-repository and environment guards for the production
// release coordinator. Split from release-production.mjs to keep
// both files under the 300-line modularity boundary.
export const CANONICAL_REPOSITORY = 'ogabasseyy/Baci';

export function originRepoSlug(remoteUrl) {
  const raw = String(remoteUrl ?? '');
  // scp-like and ssh:// forms carry no userinfo ambiguity: the user
  // is part of the match, so handle them before URL parsing (which
  // would reject the scp-like form outright).
  const direct = /^(?:git@github\.com:|ssh:\/\/git@github\.com\/)(.+)$/i.exec(
    raw.replace(/\/+$/, '').replace(/\.git$/, '')
  );
  if (direct) return direct[1].toLowerCase();
  // Parse http(s) with the URL class instead of regex-stripping '@':
  // a fragment like https://evil.com#@github.com/org/repo has host
  // evil.com, but a strip-to-last-'@' would forge a github.com match.
  // URL separates userinfo, host, path, query, and fragment, so only
  // a true github.com host passes. Credentials in userinfo never
  // reach the match or any error message.
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return '';
  }
  if ((parsed.protocol !== 'https:' && parsed.protocol !== 'http:') || parsed.hostname.toLowerCase() !== 'github.com') {
    return '';
  }
  const path = parsed.pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/, '');
  return path ? path.toLowerCase() : '';
}

export function assertCanonicalOriginPushUrls(pushUrls, canonical = CANONICAL_REPOSITORY) {
  const urls = String(pushUrls ?? '').split('\n').map(line => line.trim()).filter(Boolean);
  if (urls.length === 0 || !urls.every(url => originRepoSlug(url) === canonical.toLowerCase())) {
    throw new Error('release checkout must use the canonical repository');
  }
}

export function assertCleanWorkerDeployEnv(env = process.env) {
  if (env.BACI_DEPLOY_SKIP_INFLIGHT_CHECK === '1') {
    throw new Error('refusing release with BACI_DEPLOY_SKIP_INFLIGHT_CHECK=1; unset it so worker promotion stays strict');
  }
  if (env.BACI_DEPLOY_WORKFLOW_REPO) {
    throw new Error(`refusing release with BACI_DEPLOY_WORKFLOW_REPO=${env.BACI_DEPLOY_WORKFLOW_REPO}; unset it so promotion queries the canonical repository`);
  }
  // gh resolves unqualified repos against GH_HOST, so an inherited
  // enterprise host would silently redirect every run query and
  // dispatch away from the canonical repository validated above.
  if (env.GH_HOST && String(env.GH_HOST).toLowerCase() !== 'github.com') {
    throw new Error(`refusing release with GH_HOST=${env.GH_HOST}; unset it so gh queries github.com`);
  }
}
