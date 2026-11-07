// Shared helpers for the money-pr-assurance runner tests.
import { runAssurance } from './money-pr-assurance.mjs';
import {
  createFakeGitHub,
  HEAD,
  loadRawConfig,
  OLD_HEAD,
} from './money-pr-assurance.test-support.mjs';
import { parseAssuranceConfig } from './money-pr-assurance-config.mjs';

const config = parseAssuranceConfig(loadRawConfig());
export const baseEnv = {
  GITHUB_TOKEN: 'test-token',
  GITHUB_REPOSITORY: 'o/r',
  GITHUB_API_URL: 'https://api.github.test',
  RUN_URL: 'https://github.test/o/r/actions/runs/1',
};

export function prRoute(number, files, extra = {}) {
  return {
    [`GET /repos/o/r/pulls/${number}`]: {
      json: {
        number,
        state: 'open',
        head: { sha: HEAD },
        body: '',
        labels: [],
        changed_files: files.length,
        ...extra,
      },
    },
    [`GET /repos/o/r/pulls/${number}/files?per_page=100`]: { json: files },
  };
}

export function statusBodies(fake) {
  return fake.calls
    .filter(({ key }) => key.startsWith('POST /repos/o/r/statuses/'))
    .map(({ body }) => JSON.parse(body));
}

// Retries wait through an injected sleep that only records the delay, so
// no test waits on a real timer.
export async function run(env, routes) {
  const fake = createFakeGitHub({
    [`POST /repos/o/r/statuses/${HEAD}`]: { status: 201, json: {} },
    [`POST /repos/o/r/statuses/${OLD_HEAD}`]: { status: 201, json: {} },
    ...routes,
  });
  const summaries = [];
  const sleeps = [];
  const result = await runAssurance({
    env: { ...baseEnv, ...env },
    fetchImpl: fake.fetch,
    config,
    appendSummary: (text) => summaries.push(text),
    log: () => undefined,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  return { fake, result, summaries, sleeps };
}

export function flakyPullRoute(number, failures, files) {
  const ok = prRoute(number, files);
  let calls = 0;
  return {
    ...ok,
    [`GET /repos/o/r/pulls/${number}`]: () => {
      calls += 1;
      return calls <= failures
        ? { status: 502, json: { message: 'bad gateway' } }
        : ok[`GET /repos/o/r/pulls/${number}`];
    },
  };
}
