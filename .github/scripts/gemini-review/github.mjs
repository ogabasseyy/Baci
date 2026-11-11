// Minimal GitHub REST client (fetch only, no dependencies). The token never appears in an error.
export function githubClient({ token, repo, apiUrl = 'https://api.github.com', fetchImpl = fetch }) {
  async function request(method, path, body) {
    const response = await fetchImpl(`${apiUrl}/repos/${repo}/${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'baci-gemini-review',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`GitHub API ${response.status} for ${method} ${path.split('?')[0]}`);
    }
    return response.status === 204 ? null : response.json();
  }

  return {
    post: (path, body) => request('POST', path, body),
    async paginate(path, { maxPages = 10 } = {}) {
      const items = [];
      for (let page = 1; page <= maxPages; page += 1) {
        const batch = await request('GET', `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
        items.push(...batch);
        if (batch.length < 100) break;
      }
      return items;
    },
  };
}
