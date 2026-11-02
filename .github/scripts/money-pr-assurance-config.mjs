// Loads and validates .github/money-path-paths.json and classifies a PR's
// changed files. A malformed configuration throws: the gate must never pass
// PRs because its own settings could not be read.
import { readFileSync } from 'node:fs';
import { normaliseWord } from './money-pr-assurance-paths.mjs';

export {
  changedPaths,
  classifyChangedFiles,
  globToRegExp,
  matchesAny,
  matchesMoneyContent,
  matchesMoneyOperation,
} from './money-pr-assurance-paths.mjs';

const REVIEWER_KINDS = new Set(['codex-clean-comment', 'verdict-block']);
// Every workflow's GITHUB_TOKEN, including one a pull request controls,
// comments as this login, so nothing it posts can prove who reviewed.
const SHARED_ACTIONS_LOGIN = 'github-actions[bot]';

function fail(message) {
  throw new Error(`money-path-paths.json: ${message}`);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function requireStringList(value, name, { allowEmpty = false } = {}) {
  if (
    !Array.isArray(value) ||
    (!allowEmpty && value.length === 0) ||
    !value.every(isNonEmptyString)
  ) {
    fail(`${name} must be a ${allowEmpty ? '' : 'non-empty '}list of strings`);
  }
  return [...value];
}

function requireTrustedLogins(value, name) {
  const logins = requireStringList(value, name);
  if (logins.some((login) => login.toLowerCase() === SHARED_ACTIONS_LOGIN))
    fail(`${name} must not include ${SHARED_ACTIONS_LOGIN}`);
  return logins;
}

function parseFamilies(families) {
  if (!families || typeof families !== 'object')
    fail('reviewers.families must be an object');
  const parsed = {};
  for (const [name, family] of Object.entries(families)) {
    if (!family || !REVIEWER_KINDS.has(family.kind))
      fail(`reviewers.families.${name}.kind is not supported`);
    const codex = family.kind === 'codex-clean-comment';
    const prefix = `reviewers.families.${name}`;
    if (!isNonEmptyString(family.requestPhrase))
      fail(`${prefix}.requestPhrase is required`);
    parsed[name] = {
      name,
      kind: family.kind,
      logins: requireTrustedLogins(family.logins, `${prefix}.logins`),
      cleanPhrases: codex
        ? requireStringList(family.cleanPhrases, `${prefix}.cleanPhrases`)
        : [],
      // A verdict counts only after the latest request, from one of these
      // logins, to follow the money-rules prompt for the exact head commit.
      requestPhrase: family.requestPhrase,
      requestedBy: requireTrustedLogins(
        family.requestedBy,
        `${prefix}.requestedBy`
      ),
      requiredMarker:
        family.requiredMarker === undefined
          ? null
          : String(family.requiredMarker),
    };
  }
  return parsed;
}

function parseReviewers(reviewers) {
  if (!reviewers || typeof reviewers !== 'object')
    fail('reviewers must be an object');
  const families = parseFamilies(reviewers.families);
  const groups = reviewers.groups;
  if (!Array.isArray(groups) || groups.length < 2)
    fail('reviewers.groups needs at least two reviewer groups');
  const seen = new Set();
  for (const group of groups) {
    requireStringList(group, 'reviewers.groups entry');
    for (const name of group) {
      if (!families[name])
        fail(`unknown reviewer family "${name}" in reviewers.groups`);
      if (seen.has(name))
        fail(
          'reviewers.groups must name different model families in each group'
        );
      seen.add(name);
    }
  }
  if (!isNonEmptyString(reviewers.promptVersion))
    fail('reviewers.promptVersion is required');
  if (!isNonEmptyString(reviewers.promptPath))
    fail('reviewers.promptPath is required');
  return {
    promptPath: reviewers.promptPath,
    promptVersion: reviewers.promptVersion,
    groups: groups.map((group) => [...group]),
    families,
  };
}

function parseSummary(summary) {
  if (!summary || typeof summary !== 'object')
    fail('summary must be an object');
  if (!isNonEmptyString(summary.directory))
    fail('summary.directory is required');
  if (!Number.isInteger(summary.maxWords) || summary.maxWords < 1)
    fail('summary.maxWords must be a positive integer');
  return {
    directory: summary.directory.replace(/\/+$/, ''),
    ignoredFiles: requireStringList(
      summary.ignoredFiles ?? [],
      'summary.ignoredFiles',
      { allowEmpty: true }
    ),
    maxWords: summary.maxWords,
    headings: requireStringList(summary.headings, 'summary.headings'),
  };
}

function parseMoneyKeywords(value) {
  if (!value || typeof value !== 'object')
    fail('moneyKeywords must be an object');
  const keywords = requireStringList(value.keywords, 'moneyKeywords.keywords');
  return {
    // Keywords apply everywhere except these patterns, so a new folder is
    // covered without a configuration change.
    outside: requireStringList(value.outside, 'moneyKeywords.outside'),
    contentPaths: requireStringList(
      value.contentPaths,
      'moneyKeywords.contentPaths'
    ),
    // Money verbs matched as whole words or identifier parts in changed text.
    contentWords: requireStringList(
      value.contentWords,
      'moneyKeywords.contentWords'
    ).map(normaliseWord),
    keywords: [...new Set(keywords.map(normaliseWord))],
  };
}

function parseRequiredChecks(checks) {
  if (!Array.isArray(checks) || checks.length === 0)
    fail('requiredChecks must be a non-empty list');
  return checks.map((check) => {
    if (!check || !isNonEmptyString(check.name))
      fail('requiredChecks entries need a name');
    if (!isNonEmptyString(check.workflow))
      fail(`requiredChecks.${check.name}.workflow is required`);
    return {
      name: check.name,
      workflow: check.workflow,
      skipAllowedUnlessChanged:
        check.skipAllowedUnlessChanged === undefined
          ? null
          : requireStringList(
              check.skipAllowedUnlessChanged,
              `requiredChecks.${check.name}.skipAllowedUnlessChanged`
            ),
    };
  });
}

export function parseAssuranceConfig(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    fail('configuration must be an object');
  if (raw.version !== 1) fail('version must be 1');
  if (!isNonEmptyString(raw.statusContext)) fail('statusContext is required');
  const signoff = raw.ownerSignoff;
  if (!signoff || typeof signoff !== 'object')
    fail('ownerSignoff must be an object');
  if (!isNonEmptyString(signoff.phrase) || !isNonEmptyString(signoff.label))
    fail('ownerSignoff needs phrase and label');
  return {
    statusContext: raw.statusContext,
    moneyKeywords: parseMoneyKeywords(raw.moneyKeywords),
    moneyPaths: requireStringList(raw.moneyPaths, 'moneyPaths'),
    governancePaths: requireStringList(raw.governancePaths, 'governancePaths'),
    summary: parseSummary(raw.summary),
    evidence: {
      directory: isNonEmptyString(raw.evidence?.directory)
        ? raw.evidence.directory.replace(/\/+$/, '')
        : fail('evidence.directory is required'),
    },
    reviewers: parseReviewers(raw.reviewers),
    ownerSignoff: {
      logins: requireTrustedLogins(signoff.logins, 'ownerSignoff.logins'),
      label: signoff.label,
      phrase: signoff.phrase,
    },
    requiredChecks: parseRequiredChecks(raw.requiredChecks),
    signoffPaths: requireStringList(
      raw.signoffPaths?.paths ?? [],
      'signoffPaths.paths',
      { allowEmpty: true }
    ),
  };
}

export function loadAssuranceConfig(path) {
  return parseAssuranceConfig(JSON.parse(readFileSync(path, 'utf8')));
}

