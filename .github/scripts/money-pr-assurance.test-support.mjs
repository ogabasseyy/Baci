// Deterministic fixtures for the money-pr-assurance tests. Every SHA, login
// and timestamp is fixed so the suites never depend on randomness or time.
import { readFileSync } from 'node:fs';

export const HEAD = '0123456789abcdef0123456789abcdef01234567';
export const OLD_HEAD = 'fedcba9876543210fedcba9876543210fedcba98';
export const OWNER = 'ogabasseyy';
export const CODEX = 'chatgpt-codex-connector[bot]';
export const CLAUDE = 'claude[bot]';
export const ACTIONS_BOT = 'github-actions[bot]';
export const PROMPT_VERSION = 'money-rules-adversarial-review/v1';
export const PROMPT_PATH = '.github/prompts/money-rules-adversarial-review.md';
export const TASK_ID = 'P5-engine-schema';
export const SUMMARY_PATH = `docs/piggyvest-change-summaries/${TASK_ID}.md`;
export const EVIDENCE_PATH = 'docs/piggyvest-contract-evidence/2026-10-31.md';

export function readRepoFile(relativePath) {
  return readFileSync(
    new URL(`../../${relativePath}`, import.meta.url),
    'utf8'
  );
}

export function loadRawConfig() {
  return JSON.parse(readRepoFile('.github/money-path-paths.json'));
}

// Minute offsets keep comment ordering explicit without reading the clock.
export function at(minute) {
  return new Date(Date.UTC(2026, 9, 31, 12, minute, 0)).toISOString();
}

export function validSummary({
  taskId = TASK_ID,
  signoff = 'required',
  extra = '',
} = {}) {
  return [
    '# Ledger tables for the transfer engine',
    '',
    `Task: ${taskId}`,
    `Owner sign-off: ${signoff}`,
    '',
    '## What changes',
    '',
    'Adds the records the transfer engine will use to track each money movement.',
    '',
    '## Why',
    '',
    'Every transfer needs one durable record before any money moves.',
    '',
    '## What could go wrong and how it is prevented',
    '',
    'A transfer could be counted twice. Each record has a unique reference, so a repeat is refused.',
    '',
    '## How it is tested',
    '',
    'Automated database tests replay every change from scratch and try duplicate and parallel requests.',
    '',
    '## How it stays switched off',
    '',
    'Nothing calls the new records until the owner turns on the transfer engine flag.',
    extra,
    '',
  ].join('\n');
}

// `editor` is the login that last edited the item, or null if never edited.
export function comment(login, body, minute = 1, extra = {}) {
  return {
    id: 1000 + minute,
    nodeId: `IC_${1000 + minute}`,
    login,
    userType: login.endsWith('[bot]') ? 'Bot' : 'User',
    body,
    createdAt: at(minute),
    updatedAt: at(minute),
    editor: null,
    ...extra,
  };
}

export function review(login, body, commitId, minute = 1) {
  return {
    id: 2000 + minute,
    nodeId: `PRR_${2000 + minute}`,
    login,
    userType: login.endsWith('[bot]') ? 'Bot' : 'User',
    body,
    commitId,
    state: 'COMMENTED',
    submittedAt: at(minute),
    editor: null,
  };
}

// The owner's (or an agent's) request for the money-rules Codex review.
export function codexRequest(minute = 1, login = OWNER) {
  return comment(
    login,
    `@codex review Follow the main branch's ${PROMPT_PATH}, not this pull request's copy.`,
    minute,
    { id: 3000 + minute, nodeId: `IC_${3000 + minute}` }
  );
}

export function codexClean(sha = HEAD, minute = 2) {
  return comment(
    CODEX,
    `Codex Review: Didn't find any major issues. Nice work.\n\n**Reviewed commit:** \`${sha.slice(0, 10)}\``,
    minute
  );
}

export function verdictBlock({
  verdict = 'PASS',
  sha = HEAD,
  prompt = PROMPT_VERSION,
} = {}) {
  return [
    `MONEY-RULES-VERDICT: ${verdict}`,
    `REVIEWED-HEAD: ${sha}`,
    `PROMPT-VERSION: ${prompt}`,
  ].join('\n');
}

export function claudeVerdict(options = {}, minute = 3) {
  return comment(
    CLAUDE,
    `## Money-rules review\n\nNo rule can be broken.\n\n${verdictBlock(options)}\n`,
    minute
  );
}

export function ownerApproval(sha = HEAD, login = OWNER, minute = 4) {
  return comment(login, `summary-approved ${sha.slice(0, 7)}`, minute);
}

export function checkRun(name, conclusion = 'success', id = 1) {
  return {
    id,
    name,
    status: conclusion === null ? 'in_progress' : 'completed',
    conclusion,
    startedAt: at(id),
  };
}

export function passingChecks() {
  return [
    checkRun('Quality Gate', 'success', 1),
    checkRun('Quality Gate - DB Replay', 'success', 2),
    checkRun('Quality Gate - Disposable SQL Suites', 'success', 3),
  ];
}

// A money-path PR snapshot that satisfies every requirement, including owner
// sign-off. Tests remove or replace one piece to prove each rule fails.
export function moneySnapshot(overrides = {}) {
  const files = overrides.files ?? [
    {
      filename: 'supabase/migrations/20261101000000_piggyvest_engine.sql',
      status: 'added',
    },
    {
      filename: 'apps/web/src/lib/piggyvest/transfer-engine.ts',
      status: 'added',
    },
    { filename: SUMMARY_PATH, status: 'added' },
    { filename: EVIDENCE_PATH, status: 'added' },
  ];
  return {
    pr: {
      number: 4242,
      headSha: HEAD,
      body: `Sandbox evidence: ${EVIDENCE_PATH}`,
      labels: [],
      changedFiles: files.length,
      ...overrides.pr,
    },
    files,
    summaries: overrides.summaries ?? { [SUMMARY_PATH]: validSummary() },
    evidenceExists: overrides.evidenceExists ?? { [EVIDENCE_PATH]: true },
    comments: overrides.comments ?? [
      codexRequest(),
      codexClean(),
      claudeVerdict(),
      ownerApproval(),
    ],
    reviews: overrides.reviews ?? [],
    threads: overrides.threads ?? [{ isResolved: true, path: 'a.ts' }],
    checkRuns: overrides.checkRuns ?? passingChecks(),
  };
}

function fakeResponse({ status = 200, json, text, link } = {}) {
  const payload = text ?? (json === undefined ? '' : JSON.stringify(json));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name) => (name.toLowerCase() === 'link' ? (link ?? null) : null),
    },
    json: async () => JSON.parse(payload),
    text: async () => payload,
  };
}

// A routing fake for global fetch: keys are "<METHOD> <path+query>". An
// unknown request answers 599 so a missing route fails loudly in tests.
export function createFakeGitHub(routes) {
  const calls = [];
  function fetch(url, init = {}) {
    const parsed = new URL(url);
    const method = (init.method ?? 'GET').toUpperCase();
    const key = `${method} ${parsed.pathname}${parsed.search}`;
    const headers = Object.fromEntries(
      Object.entries(init.headers ?? {}).map(([name, value]) => [
        name.toLowerCase(),
        value,
      ])
    );
    calls.push({ key, headers, body: init.body });
    const route = routes[key];
    if (!route) {
      return Promise.resolve(
        fakeResponse({ status: 599, json: { message: `unexpected ${key}` } })
      );
    }
    return Promise.resolve(
      fakeResponse(
        typeof route === 'function' ? route({ key, body: init.body }) : route
      )
    );
  }
  return { fetch, calls };
}
