// Shared helpers for the review-first-ci tests (not production code).
import { readFileSync } from 'node:fs';

export const REPO = 'o/r';
export const HEAD = 'd9df294247dc5e1aa215e269ad96aa3c2eeb8ca5';
export const NOW = '2026-11-11T14:00:00Z';

export const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

export function pullRequest(overrides = {}) {
  return {
    number: 7,
    state: 'open',
    draft: false,
    labels: [],
    base: { ref: 'main' },
    head: { sha: HEAD, ref: 'feature', repo: { full_name: REPO } },
    ...overrides,
  };
}

// A fake GitHub client keyed by request path. A value that is an Error is thrown;
// a function receives the body (for post). Every call is recorded in `calls`.
export function fakeGithub(routes = {}) {
  const calls = [];
  const find = (method, path) => {
    const key = `${method} ${path}`;
    if (!(key in routes)) throw new Error(`HTTP 404 for ${key}`);
    const value = routes[key];
    if (value instanceof Error) throw value;
    return value;
  };
  return {
    calls,
    async get(path) {
      calls.push(`GET ${path}`);
      return find('GET', path);
    },
    async paginate(path) {
      calls.push(`GET ${path}`);
      return find('GET', path);
    },
    async post(path, body) {
      calls.push(`POST ${path}`);
      const value = find('POST', path);
      return typeof value === 'function' ? value(body) : value;
    },
  };
}

export const codexRoutes = ({ issueComments = [], reviews = [], reviewComments = [], pr = pullRequest(), number = pr.number } = {}) => ({
  [`GET /repos/${REPO}/pulls/${number}`]: pr,
  [`GET /repos/${REPO}/issues/${number}/comments`]: issueComments,
  [`GET /repos/${REPO}/pulls/${number}/reviews`]: reviews,
  [`GET /repos/${REPO}/pulls/${number}/comments`]: reviewComments,
  [`GET /repos/${REPO}/issues/${number}/events`]: [],
});
