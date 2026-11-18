// The runner allows 75 seconds. Leave room for RLS reads and response cleanup.
export const OWNER_PREVIEW_WORK_TIMEOUT_MS = 90_000;
// Let the bridge report its own deadline before the caller aborts.
export const OWNER_PREVIEW_CALL_TIMEOUT_MS = 100_000;
