import { describe, expect, it } from 'vitest';
import { verifyEventPipelineBoundaries } from './verify-event-pipeline-boundaries';

// The whole-repository scan finishes in ~3 min on a web test shard but takes
// ~26 min in the shared "Quality Gate - Test" job (parallel workers on a
// 2-vCPU runner), where an 8-min limit failed every run before it could
// report. Stay inside that job's 45-min timeout-minutes.
const LIVE_REPOSITORY_SCAN_TIMEOUT_MS = 35 * 60_000;

describe('live event pipeline boundary', () => {
  it(
    'passes the current repository boundary contract',
    () => {
      expect(verifyEventPipelineBoundaries()).toEqual([]);
    },
    LIVE_REPOSITORY_SCAN_TIMEOUT_MS
  );
});
