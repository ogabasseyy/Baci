import { describe, expect, it } from 'vitest';
import { verifyEventPipelineBoundaries } from './verify-event-pipeline-boundaries';

// The whole-repository scan finishes in ~3 min with every blob checked out.
// CI runs it in "Quality Gate - Repository Scans" (vitest.repository-scans.ts);
// in the old blob:none test job lazy blob fetches pushed it past 35 min. Keep
// headroom for a slow runner, but fail well inside that job's 20-min limit.
const LIVE_REPOSITORY_SCAN_TIMEOUT_MS = 12 * 60_000;

describe('live event pipeline boundary', () => {
  it(
    'passes the current repository boundary contract',
    () => {
      expect(verifyEventPipelineBoundaries()).toEqual([]);
    },
    LIVE_REPOSITORY_SCAN_TIMEOUT_MS
  );
});
