import { execFileSync } from 'node:child_process';
import { redactCodexError } from './remediation-codex-output.mjs';

const GITHUB_PULL_REQUEST_URL =
  /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9][0-9]*$/;

function statusFromPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('GitHub pull request lookup returned an invalid result');
  }
  const state = payload.state;
  const mergedAt = payload.mergedAt;
  if (state === 'OPEN' && mergedAt === null) return 'open';
  if (state === 'MERGED') return 'merged';
  if (state === 'CLOSED' && mergedAt === null) return 'closed';
  if (
    state === 'CLOSED' &&
    typeof mergedAt === 'string' &&
    Number.isFinite(Date.parse(mergedAt))
  ) {
    return 'merged';
  }
  throw new Error('GitHub pull request lookup returned an invalid state');
}

export function createRemediationDraftPrStatusResolver({
  ghBin = 'gh',
  runner = execFileSync,
  timeout = 10_000,
} = {}) {
  return function resolveDraftPrStatus(draftPr) {
    const url = String(draftPr?.url || '').trim();
    if (!GITHUB_PULL_REQUEST_URL.test(url)) {
      throw new Error('Stored draft pull request URL is invalid');
    }
    let output;
    try {
      output = runner(ghBin, ['pr', 'view', url, '--json', 'state,mergedAt'], {
        encoding: 'utf8',
        shell: false,
        timeout,
      });
    } catch (error) {
      throw redactCodexError(error);
    }
    try {
      return statusFromPayload(JSON.parse(String(output || '')));
    } catch (error) {
      throw redactCodexError(error);
    }
  };
}
