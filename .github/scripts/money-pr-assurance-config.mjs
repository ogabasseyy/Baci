// Loads and validates .github/money-path-paths.json and classifies a PR's
// changed files. A malformed configuration throws: the gate must never pass
// PRs because its own settings could not be read.
import { readFileSync } from 'node:fs';

const REVIEWER_KINDS = new Set(['codex-clean-comment', 'verdict-block']);

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

function parseFamilies(families) {
  if (!families || typeof families !== 'object')
    fail('reviewers.families must be an object');
  const parsed = {};
  for (const [name, family] of Object.entries(families)) {
    if (!family || !REVIEWER_KINDS.has(family.kind))
      fail(`reviewers.families.${name}.kind is not supported`);
    parsed[name] = {
      name,
      kind: family.kind,
      logins: requireStringList(
        family.logins,
        `reviewers.families.${name}.logins`
      ),
      cleanPhrases:
        family.kind === 'codex-clean-comment'
          ? requireStringList(
              family.cleanPhrases,
              `reviewers.families.${name}.cleanPhrases`
            )
          : [],
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

function parseRequiredChecks(checks) {
  if (!Array.isArray(checks) || checks.length === 0)
    fail('requiredChecks must be a non-empty list');
  return checks.map((check) => {
    if (!check || !isNonEmptyString(check.name))
      fail('requiredChecks entries need a name');
    return {
      name: check.name,
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
      logins: requireStringList(signoff.logins, 'ownerSignoff.logins'),
      label: signoff.label,
      phrase: signoff.phrase,
    },
    requiredChecks: parseRequiredChecks(raw.requiredChecks),
  };
}

export function loadAssuranceConfig(path) {
  return parseAssuranceConfig(JSON.parse(readFileSync(path, 'utf8')));
}

// Minimal glob support: "**" spans directories, "*" and "?" stay inside one
// path segment, and every other character is literal.
export function globToRegExp(glob) {
  let pattern = '';
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === '*' && glob[index + 1] === '*') {
      index += 1;
      if (glob[index + 1] === '/') {
        index += 1;
        pattern += '(?:.*/)?';
      } else {
        pattern += '.*';
      }
    } else if (char === '*') {
      pattern += '[^/]*';
    } else if (char === '?') {
      pattern += '[^/]';
    } else {
      pattern += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${pattern}$`, 'i');
}

export function matchesAny(path, globs) {
  return globs.some((glob) => globToRegExp(glob).test(path));
}

// Both sides of a rename count, so moving a file out of a money path is
// still reviewed as a money-path change.
export function changedPaths(files) {
  const paths = [];
  for (const file of files) {
    for (const path of [file.previousFilename, file.filename]) {
      if (isNonEmptyString(path) && !paths.includes(path)) paths.push(path);
    }
  }
  return paths;
}

export function classifyChangedFiles(files, config) {
  const paths = changedPaths(files);
  const governanceFiles = paths.filter((path) =>
    matchesAny(path, config.governancePaths)
  );
  const moneyFiles = paths.filter(
    (path) =>
      governanceFiles.includes(path) || matchesAny(path, config.moneyPaths)
  );
  return { isMoneyPath: moneyFiles.length > 0, moneyFiles, governanceFiles };
}
