// Minimal GitHub REST client for the review-first CI scripts (fetch only, no
// dependencies). Reads retry once on a 5xx or a network error; 4xx never retries.
const MAX_PAGES = 20;
const PAGE_SIZE = 100;

export function createGithubClient({ token, apiUrl = 'https://api.github.com', fetchImpl = globalThis.fetch, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  if (!token) throw new Error('GitHub token is required (GITHUB_TOKEN)');

  let remaining = null;
  const headers = {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    'user-agent': 'review-first-ci',
    'x-github-api-version': '2022-11-28',
  };

  async function send(method, path, body) {
    let lastError;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const response = await fetchImpl(`${apiUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
        if (response.status >= 500 && attempt === 1) {
          await sleep(1000);
          continue;
        }
        const left = Number.parseInt(response.headers?.get?.('x-ratelimit-remaining') ?? '', 10);
        if (Number.isFinite(left)) remaining = left;
        if (!response.ok) throw new Error(`HTTP ${response.status} for ${path}`);
        const text = await response.text();
        return text ? JSON.parse(text) : {};
      } catch (error) {
        lastError = error;
        if (/^HTTP \d+/.test(error.message) || attempt === 2) throw error;
        await sleep(1000);
      }
    }
    throw lastError;
  }

  const withPage = (path, page) => `${path}${path.includes('?') ? '&' : '?'}per_page=${PAGE_SIZE}&page=${page}`;

  return {
    // requests left in the current hour for this token, as last reported by GitHub (null = unknown)
    rateRemaining: () => remaining,
    get: (path) => send('GET', path),
    post: (path, body) => send('POST', path, body),
    async paginate(path, key) {
      const all = [];
      for (let page = 1; page <= MAX_PAGES; page += 1) {
        const body = await send('GET', withPage(path, page));
        const items = key ? body[key] : body;
        if (!Array.isArray(items)) throw new Error(`unexpected non-list response for ${path}`);
        all.push(...items);
        if (items.length < PAGE_SIZE) return all;
      }
      // The last allowed page was still full: more entries may exist. Returning what we have would
      // let an early clean verdict hide newer findings, so make the caller fail closed instead.
      throw new Error(`too many entries for ${path} (more than ${MAX_PAGES * PAGE_SIZE})`);
    },
  };
}
