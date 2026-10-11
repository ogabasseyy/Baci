// Canonical-repository and environment guards for the production
// release coordinator. Split from release-production.mjs to keep
// both files under the 300-line modularity boundary.
export const CANONICAL_REPOSITORY = 'ogabasseyy/Baci';

export function originRepoSlug(remoteUrl) {
  const raw = String(remoteUrl ?? '');
  // Reject surrounding whitespace instead of trimming it: URL
  // parsing strips it, but git uses the raw remote, so validating a
  // normalized copy passes preflight for a checkout git refuses.
  if (raw !== raw.trim()) return '';
  // scp-like and ssh:// forms carry no userinfo ambiguity: the user
  // is part of the match, so handle them before URL parsing (which
  // would reject the scp-like form outright).
  const stripped = raw.replace(/\/+$/, '').replace(/\.git$/, '');
  const direct = /^(?:git@github\.com:|ssh:\/\/git@github\.com\/)(.+)$/i.exec(stripped);
  if (direct) {
    // The worker guard only enters scp normalization for lowercase
    // git@ (ssh:// authority is lowercased downstream instead), so a
    // GIT@ scp spelling would pass here and abort the deploy.
    if (/^git@/i.test(stripped) && !stripped.startsWith('git@')) return '';
    return direct[1].toLowerCase();
  }
  // Parse https with the URL class instead of regex-stripping '@':
  // a fragment like https://evil.com#@github.com/org/repo has host
  // evil.com, but a strip-to-last-'@' would forge a github.com match.
  // URL separates userinfo, host, path, query, and fragment, so only
  // a true github.com host passes. Credentials in userinfo never
  // reach the match or any error message. Plaintext http is refused:
  // a release checkout must use https or ssh. Non-default ports are
  // refused too (URL normalizes :443 away, so any surviving port is
  // one the worker guard would abort on).
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return '';
  }
  if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'github.com' || parsed.port !== '') {
    return '';
  }
  // Reject noncanonical raw port spellings: URL normalizes :0443 to
  // the default port (empty), but the worker guard strips only the
  // literal :443 and would refuse the checkout downstream. The raw
  // port text must be absent or exactly 443.
  const authority = raw.slice(raw.indexOf('://') + 3).split(/[\/?#]/, 1)[0];
  const hostPort = authority.slice(authority.lastIndexOf('@') + 1);
  const colon = hostPort.indexOf(':');
  if (colon !== -1 && hostPort.slice(colon + 1) !== '443') {
    return '';
  }
  // Reject query/fragment suffixes: the worker guard refuses them, so
  // accepting here would only abort every release from this checkout
  // later with a less direct error. Fail fast at validation instead.
  if (parsed.search !== '' || parsed.hash !== '') {
    return '';
  }
  // Reject spellings the URL parser normalizes away: dot segments
  // (github.com/evil/../owner/repo) collapse in pathname, but the
  // worker guard parses the raw path and would refuse the checkout
  // downstream. The raw path must equal the serialized pathname.
  const pathStart = raw.indexOf('/', raw.indexOf('://') + 3);
  const rawPath = pathStart === -1 ? '/' : raw.slice(pathStart);
  if (rawPath !== parsed.pathname) {
    return '';
  }
  // Duplicate slashes survive URL parsing untouched, so they pass the
  // equality check above while the worker guard (which splits the raw
  // path) cannot resolve them. Refuse them here as well.
  if (rawPath.includes('//')) {
    return '';
  }
  const path = parsed.pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/, '');
  return path ? path.toLowerCase() : '';
}

export function assertCanonicalOriginPushUrls(pushUrls, canonical = CANONICAL_REPOSITORY) {
  // Reject surrounding whitespace instead of trimming it: git uses
  // the raw push URL, so validating a normalized copy passes
  // preflight for a remote every later git operation refuses.
  const urls = String(pushUrls ?? '').split('\n').filter(line => line !== '');
  if (urls.length === 0 || urls.some(line => line.trim() !== line) || !urls.every(url => originRepoSlug(url) === canonical.toLowerCase())) {
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
  // The barrier-ID suffix is test-only (set by the promote fixtures):
  // a fixed suffix removes host/PID uniqueness, so two coordinators
  // promoting the same SHA could share one barrier and the first
  // post-flip refresh would clear it while the second promotion is
  // still active, reopening the mid-stall publication hole.
  if (env.PROMOTE_BARRIER_ID_SUFFIX) {
    throw new Error(`refusing release with PROMOTE_BARRIER_ID_SUFFIX=${env.PROMOTE_BARRIER_ID_SUFFIX}; unset it so barriers stay unique per deploy`);
  }
}
