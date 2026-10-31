import { buildExpectedPendingSources } from './build-expected-pending-sources.test-support';

// Discovered, not hand-listed: the frozen pre-registry entries plus every
// `replay-registry/*/expected-pending-sources.txt` (see its README.md).
export const EXPECTED_PENDING_SOURCES = buildExpectedPendingSources();
