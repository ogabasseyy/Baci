// Thin GitHub REST/GraphQL client plus the reads that build an assurance
// snapshot. It never checks out or executes pull-request code: the summary
// and evidence files are read as data through the contents API.
import { classifyChangedFiles } from './money-pr-assurance-config.mjs';
import {
  evidencePathsToCheck,
  summaryPathsToFetch,
} from './money-pr-assurance-evaluate.mjs';

const MAX_PAGES = 50;
const MAX_STATUS_DESCRIPTION = 140;

function nextLink(header) {
  const match = /<([^>]+)>;\s*rel="next"/.exec(header ?? '');
  return match ? match[1] : null;
}

function encodePath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

export function createGitHubClient({
  token,
  fetchImpl = fetch,
  apiUrl = 'https://api.github.com',
}) {
  const base = new URL(apiUrl);
  const baseUrl = base.href.replace(/\/+$/, '');

  async function send(
    method,
    url,
    { body, accept = 'application/vnd.github+json' } = {}
  ) {
    const response = await fetchImpl(url, {
      method,
      headers: {
        Accept: accept,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return response;
  }

  async function request(
    method,
    path,
    { body, accept, allowNotFound = false } = {}
  ) {
    const response = await send(method, `${baseUrl}${path}`, { body, accept });
    if (allowNotFound && response.status === 404) return null;
    if (!response.ok)
      throw new Error(
        `GitHub ${method} ${path} failed with ${response.status}`
      );
    const text = await response.text();
    if (accept?.includes('raw')) return text;
    return text ? JSON.parse(text) : null;
  }

  async function getAll(path, itemsKey = null) {
    const items = [];
    let url = `${baseUrl}${path}`;
    for (let page = 0; url && page < MAX_PAGES; page += 1) {
      if (new URL(url).host !== base.host)
        throw new Error('GitHub returned an unexpected pagination host');
      const response = await send('GET', url);
      if (!response.ok)
        throw new Error(
          `GitHub GET ${new URL(url).pathname} failed with ${response.status}`
        );
      const payload = await response.json();
      items.push(...(itemsKey ? payload[itemsKey] : payload));
      url = nextLink(response.headers.get('link'));
    }
    if (url)
      throw new Error(
        `GitHub pagination for ${path} exceeded ${MAX_PAGES} pages`
      );
    return items;
  }

  async function graphql(query, variables) {
    const payload = await request('POST', '/graphql', {
      body: { query, variables },
    });
    if (payload?.errors?.length)
      throw new Error(`GitHub GraphQL error: ${payload.errors[0].message}`);
    return payload.data;
  }

  return { request, getAll, graphql };
}

const THREADS_QUERY = `query($owner: String!, $repo: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { isResolved isOutdated path }
      }
    }
  }
}`;

async function readThreads(client, { owner, repo, number }) {
  const threads = [];
  let after = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const data = await client.graphql(THREADS_QUERY, {
      owner,
      repo,
      number,
      after,
    });
    const connection = data.repository.pullRequest.reviewThreads;
    threads.push(
      ...connection.nodes.map(({ isResolved, isOutdated, path }) => ({
        isResolved,
        isOutdated,
        path,
      }))
    );
    if (!connection.pageInfo.hasNextPage) return threads;
    after = connection.pageInfo.endCursor;
  }
  throw new Error('Review thread pagination exceeded its page limit');
}

function normaliseComment(item) {
  return {
    id: item.id,
    login: item.user?.login ?? '',
    userType: item.user?.type ?? '',
    body: item.body ?? '',
    createdAt: item.created_at ?? '',
    updatedAt: item.updated_at ?? '',
  };
}

function normaliseReview(item) {
  return {
    id: item.id,
    login: item.user?.login ?? '',
    userType: item.user?.type ?? '',
    body: item.body ?? '',
    commitId: item.commit_id ?? '',
    state: item.state ?? '',
    submittedAt: item.submitted_at ?? '',
  };
}

export async function readPullRequest(client, { owner, repo, number }) {
  const raw = await client.request(
    'GET',
    `/repos/${owner}/${repo}/pulls/${number}`
  );
  return {
    number: raw.number,
    state: raw.state,
    headSha: raw.head.sha,
    body: raw.body ?? '',
    labels: (raw.labels ?? []).map(({ name }) => name),
    changedFiles: raw.changed_files ?? 0,
  };
}

// Pass an already-read PR so callers know the head SHA even if a later read
// fails; otherwise the PR is read first.
export async function collectSnapshot(
  client,
  { owner, repo, number },
  config,
  knownPr = null
) {
  const prefix = `/repos/${owner}/${repo}`;
  const pr =
    knownPr ?? (await readPullRequest(client, { owner, repo, number }));
  const files = (
    await client.getAll(`${prefix}/pulls/${number}/files?per_page=100`)
  ).map((file) => ({
    filename: file.filename,
    previousFilename: file.previous_filename ?? null,
    status: file.status,
  }));
  const complete = files.length >= pr.changedFiles;
  if (complete && !classifyChangedFiles(files, config).isMoneyPath)
    return { pr, files };

  const ref = `?ref=${encodeURIComponent(pr.headSha)}`;
  const summaries = {};
  for (const path of summaryPathsToFetch(files, config)) {
    summaries[path] = await client.request(
      'GET',
      `${prefix}/contents/${encodePath(path)}${ref}`,
      {
        accept: 'application/vnd.github.raw+json',
        allowNotFound: true,
      }
    );
  }
  const evidenceExists = {};
  for (const path of evidencePathsToCheck(pr.body, config)) {
    const found = await client.request(
      'GET',
      `${prefix}/contents/${encodePath(path)}${ref}`,
      {
        accept: 'application/vnd.github.raw+json',
        allowNotFound: true,
      }
    );
    evidenceExists[path] = found !== null;
  }
  return {
    pr,
    files,
    summaries,
    evidenceExists,
    comments: (
      await client.getAll(`${prefix}/issues/${number}/comments?per_page=100`)
    ).map(normaliseComment),
    reviews: (
      await client.getAll(`${prefix}/pulls/${number}/reviews?per_page=100`)
    ).map(normaliseReview),
    threads: await readThreads(client, { owner, repo, number }),
    checkRuns: (
      await client.getAll(
        `${prefix}/commits/${pr.headSha}/check-runs?per_page=100`,
        'check_runs'
      )
    ).map((run) => ({
      id: run.id,
      name: run.name,
      status: run.status,
      conclusion: run.conclusion ?? null,
      startedAt: run.started_at ?? '',
    })),
  };
}

export async function postStatus(
  client,
  { owner, repo, sha, state, description, context, targetUrl }
) {
  await client.request('POST', `/repos/${owner}/${repo}/statuses/${sha}`, {
    body: {
      state,
      context,
      description: description.slice(0, MAX_STATUS_DESCRIPTION),
      ...(targetUrl ? { target_url: targetUrl } : {}),
    },
  });
}

export async function findOpenPullRequestsForSha(client, { owner, repo, sha }) {
  const pulls = await client.getAll(
    `/repos/${owner}/${repo}/commits/${sha}/pulls?per_page=100`
  );
  return pulls
    .filter((pull) => pull.state === 'open' && pull.head?.sha === sha)
    .map(({ number }) => number);
}
