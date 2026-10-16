import { CANONICAL_REPOSITORY as repository } from './release-remote-validation.mjs';

export function readWorkflowRunStatus(ghInvoke, runId) {
  // JSON preserves null conclusions when the subprocess trims stdout;
  // TSV loses its trailing tab for every queued/in-progress run.
  const output = ghInvoke(['api', `repos/${repository}/actions/runs/${runId}`, '--jq', '{status, conclusion}']);
  let reading;
  try { reading = JSON.parse(output); } catch { /* Reject malformed API output below. */ }
  if (!reading || typeof reading.status !== 'string' || !reading.status.trim() || reading.status.trim() === 'null' ||
    (reading.conclusion !== null && typeof reading.conclusion !== 'string')) {
    throw new Error(`workflow run ${runId} status unreadable; inspect preceding gh diagnostics`);
  }
  return { status: reading.status.trim(), conclusion: reading.conclusion?.trim() ?? '' };
}
