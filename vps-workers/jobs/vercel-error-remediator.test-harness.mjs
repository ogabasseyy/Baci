import { runRemediationWorker } from '../lib/remediation-worker.test-harness.mjs';
import {
  groupErrorEvents,
  MAX_JSONL_ROTATED_FILES,
  readJsonlLogEvents,
  selectRemediationCandidates,
} from '../lib/vercel-error-events.mjs';

const readPositiveInt = (value, fallback) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export function runVercelErrorRemediator({ candidateLoader, ...options } = {}) {
  const loadVercelCandidates =
    candidateLoader ||
    (({ env }) => {
      const logPath = env.VERCEL_ERROR_LOG_PATH;
      if (!logPath) {
        throw new Error('VERCEL_ERROR_LOG_PATH is required');
      }
      const rawEvents = readJsonlLogEvents(logPath, {
        maxRotatedFiles: readPositiveInt(
          env.VERCEL_ERROR_LOG_MAX_ROTATED_FILES,
          MAX_JSONL_ROTATED_FILES
        ),
      });
      const groups = groupErrorEvents(rawEvents);
      return selectRemediationCandidates(groups, {
        minOccurrences: readPositiveInt(
          env.BACI_REMEDIATION_MIN_OCCURRENCES,
          2
        ),
      });
    });

  return runRemediationWorker({
    ...options,
    candidateLoader: loadVercelCandidates,
    workerName: 'vercel-error-remediator',
  });
}
