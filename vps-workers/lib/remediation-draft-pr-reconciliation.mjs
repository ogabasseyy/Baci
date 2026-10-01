import { createHash } from 'node:crypto';
import {
  formatBoundedSubprocessOutput,
  redactCodexError,
} from './remediation-codex-output.mjs';
import { buildRemediationPrBody } from './remediation-pr-body.mjs';
import { remediationObservationFor } from './remediation-state-key.mjs';

const branchSegment = (value, fallback) => {
  const segment = String(value || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  return segment || fallback;
};

function runChecked(command, args, options) {
  const result = options.runner(command, args, {
    cwd: options.cwd,
    env: options.env,
    shell: false,
    timeout: options.timeout,
  });
  if (result.error) throw redactCodexError(result.error);
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed: ${formatBoundedSubprocessOutput(result)}`
    );
  }
  return result.stdout || '';
}

function branchNameFor(candidate) {
  const source = branchSegment(
    candidate.source || candidate.sample?.source,
    'vercel'
  );
  const category = branchSegment(candidate.category, 'unknown');
  const fingerprint = branchSegment(candidate.fingerprint, 'unknown');
  const caseIdentity = String(
    candidate.caseKey || `${source}:${category}:${fingerprint}`
  );
  const observation = remediationObservationFor(candidate);
  const caseToken = createHash('sha256')
    .update(`${caseIdentity}\n${observation}`)
    .digest('hex')
    .slice(0, 12);
  return `codex/${source}-remediation-${category}-${fingerprint}-${caseToken}`;
}

export function createRemediationDraftPrReconciler({
  candidate,
  ghBin,
  options,
}) {
  const branch = branchNameFor(candidate);

  function existingDraftPrUrl() {
    const output = runChecked(
      ghBin,
      [
        'pr',
        'list',
        '--base',
        'main',
        '--head',
        branch,
        '--state',
        'open',
        '--json',
        'url',
        '--limit',
        '1',
      ],
      options
    );
    let pullRequests;
    try {
      pullRequests = JSON.parse(output);
    } catch {
      throw new Error('GitHub pull request lookup returned invalid JSON');
    }
    if (!Array.isArray(pullRequests) || pullRequests.length > 1) {
      throw new Error('GitHub pull request lookup returned an invalid result');
    }
    if (pullRequests.length === 0) return '';

    const url = String(pullRequests[0]?.url || '').trim();
    if (!url.startsWith('https://') || url.length > 500) {
      throw new Error('GitHub pull request lookup returned an invalid URL');
    }
    return url;
  }

  function remoteBranchExists() {
    const result = options.runner(
      'git',
      ['ls-remote', '--exit-code', '--heads', 'origin', branch],
      {
        cwd: options.cwd,
        env: options.env,
        shell: false,
        timeout: options.timeout,
      }
    );
    if (result.error) throw redactCodexError(result.error);
    if (result.status === 0) return Boolean(result.stdout?.trim());
    if (result.status === 2) return false;
    throw new Error(
      `git ls-remote --exit-code --heads origin ${branch} failed: ${formatBoundedSubprocessOutput(result)}`
    );
  }

  function createOrReuseDraftPr() {
    const existing = existingDraftPrUrl();
    if (existing) return existing;

    try {
      return runChecked(
        ghBin,
        [
          'pr',
          'create',
          '--base',
          'main',
          '--head',
          branch,
          '--title',
          `Fix ${candidate.sample?.source || 'production'} error ${candidate.fingerprint}`,
          '--body',
          buildRemediationPrBody(candidate),
          '--draft',
        ],
        options
      ).trim();
    } catch (error) {
      let recovered;
      try {
        recovered = existingDraftPrUrl();
      } catch {
        throw error;
      }
      if (recovered) return recovered;
      throw error;
    }
  }

  return {
    branch,
    createOrReuseDraftPr,
    existingDraftPrUrl,
    remoteBranchExists,
  };
}
