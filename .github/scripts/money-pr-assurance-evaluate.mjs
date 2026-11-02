// Combines every money-path requirement into one commit-status decision.
// "failure" means something the PR author must act on; "pending" means only
// CI checks are still running; "success" means every requirement holds.
import { evaluateRequiredChecks } from './money-pr-assurance-checks.mjs';
import {
  changedPaths,
  classifyChangedFiles,
} from './money-pr-assurance-config.mjs';
import {
  countUnresolvedThreads,
  evaluateOwnerSignoff,
  evaluateReviewers,
} from './money-pr-assurance-reviews.mjs';
import {
  findChangedSummaries,
  findEvidenceAndDarkUntil,
  validateSummary,
} from './money-pr-assurance-summary.mjs';

const MAX_DESCRIPTION = 140;

export function summaryPathsToFetch(files, config) {
  return findChangedSummaries(files, config.summary).summaries.map(
    ({ path }) => path
  );
}

export function evidencePathsToCheck(body, config) {
  return findEvidenceAndDarkUntil(body, config.evidence.directory)
    .evidencePaths;
}

// File names and headings come from the PR; strip control characters so
// they cannot break the status text or forge workflow commands in logs.
function oneLine(text) {
  return text.replace(/\p{Cc}+/gu, ' ');
}

function truncate(text) {
  return text.length <= MAX_DESCRIPTION
    ? text
    : `${text.slice(0, MAX_DESCRIPTION - 3)}...`;
}

function checkSummaries(snapshot, config, reasons) {
  const { summaries, errors } = findChangedSummaries(
    snapshot.files,
    config.summary
  );
  reasons.push(...errors);
  if (summaries.length === 0) {
    reasons.push(
      `No owner-readable summary: add ${config.summary.directory}/<task-id>.md from TEMPLATE.md.`
    );
    return false;
  }
  let signoffRequired = false;
  for (const { path, taskId } of summaries) {
    const text = snapshot.summaries?.[path];
    if (typeof text !== 'string') {
      reasons.push(`Summary ${path} could not be read at the head commit.`);
      signoffRequired = true;
      continue;
    }
    const result = validateSummary(text, { taskId, ...config.summary });
    reasons.push(...result.errors.map((error) => `Summary ${path}: ${error}`));
    signoffRequired ||= result.ownerSignoffRequired;
  }
  return signoffRequired;
}

function checkEvidence(snapshot, config, reasons) {
  const { evidencePaths, darkUntil } = findEvidenceAndDarkUntil(
    snapshot.pr.body,
    config.evidence.directory
  );
  if (darkUntil) return;
  if (evidencePaths.length === 0) {
    reasons.push(
      `PR body needs a link to sandbox evidence under ${config.evidence.directory}/ or a "Dark until: <flag or gate>" line.`
    );
    return;
  }
  if (!evidencePaths.some((path) => snapshot.evidenceExists?.[path] === true)) {
    reasons.push(
      `Linked sandbox evidence was not found at the head commit: ${evidencePaths.join(', ')}.`
    );
    return;
  }
  // Evidence already on the default branch says nothing about this change.
  const changed = new Set(
    snapshot.files
      .filter(({ status }) => status !== 'removed')
      .map(({ filename }) => filename)
  );
  if (!evidencePaths.some((path) => changed.has(path))) {
    reasons.push(
      `Linked sandbox evidence must be added or updated by this pull request: ${evidencePaths.join(', ')}.`
    );
  }
}

function decide(reasons, pending) {
  if (reasons.length > 0) {
    const noun = reasons.length === 1 ? 'requirement' : 'requirements';
    return {
      state: 'failure',
      description: truncate(`${reasons.length} ${noun} unmet: ${reasons[0]}`),
    };
  }
  if (pending.length > 0)
    return {
      state: 'pending',
      description: truncate(`Waiting: ${pending[0]}`),
    };
  return {
    state: 'success',
    description: 'Money-path assurance complete for this head commit',
  };
}

export function evaluateAssurance(snapshot, config) {
  const head = snapshot.pr.headSha;
  const complete = snapshot.files.length >= (snapshot.pr.changedFiles ?? 0);
  const classification = classifyChangedFiles(snapshot.files, config);
  if (complete && !classification.isMoneyPath) {
    return {
      state: 'success',
      description: 'Not a money-path PR',
      moneyPath: false,
      moneyFiles: [],
      reasons: [],
      pending: [],
    };
  }
  const reasons = [];
  if (!complete) {
    reasons.push(
      `The changed-file list is incomplete (${snapshot.files.length} of ${snapshot.pr.changedFiles}); treating it as a money-path PR.`
    );
  }
  // A change to the assurance rules is reviewed under the rules it changes,
  // so the owner must always approve it.
  const rulesChanged = classification.governanceFiles.length > 0;
  const signoffNeeded =
    checkSummaries(snapshot, config, reasons) ||
    snapshot.pr.labels.includes(config.ownerSignoff.label) ||
    rulesChanged;
  checkEvidence(snapshot, config, reasons);
  const reviewers = evaluateReviewers({
    comments: snapshot.comments ?? [],
    reviews: snapshot.reviews ?? [],
    head,
    reviewers: config.reviewers,
  });
  reasons.push(...reviewers.failures);
  const unresolved = countUnresolvedThreads(snapshot.threads ?? []);
  if (unresolved > 0) {
    reasons.push(
      `${unresolved} review ${unresolved === 1 ? 'thread is' : 'threads are'} unresolved.`
    );
  }
  if (signoffNeeded) {
    const signoff = evaluateOwnerSignoff({
      comments: snapshot.comments ?? [],
      reviews: snapshot.reviews ?? [],
      head,
      ownerSignoff: config.ownerSignoff,
    });
    if (!signoff.approved) {
      const why = rulesChanged
        ? ` (this pull request changes the assurance rules: ${classification.governanceFiles[0]})`
        : '';
      reasons.push(`${signoff.detail}${why}.`);
    }
  }
  const checks = evaluateRequiredChecks({
    checkRuns: snapshot.checkRuns ?? [],
    requiredChecks: config.requiredChecks,
    changedPaths: changedPaths(snapshot.files),
  });
  reasons.push(...checks.failures);
  const safeReasons = reasons.map(oneLine);
  return {
    ...decide(safeReasons, checks.pending),
    moneyPath: true,
    moneyFiles: classification.moneyFiles,
    reviewers: reviewers.families,
    reasons: safeReasons,
    pending: checks.pending,
  };
}
