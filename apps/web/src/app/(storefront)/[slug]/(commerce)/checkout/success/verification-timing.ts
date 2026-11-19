// A pending gateway response can settle shortly after the first verify
// call: re-run verification on a bounded poll so the completed branch is
// still reached without a manual refresh. Fast passes cover the common
// webhook race; the slow lane keeps observing late reconciliation (e.g. a
// captured payment whose finalization lands minutes later) instead of
// stranding the mounted page on "processing" after one minute.
export const VERIFY_REPOLL_INTERVAL_MS = 3000;
export const VERIFY_REPOLL_FAST_MAX_ATTEMPTS = 20;
export const VERIFY_REPOLL_SLOW_INTERVAL_MS = 15000;
export const VERIFY_REPOLL_MAX_ATTEMPTS = 40;
// Each pass is abort-bounded so one hung connection releases the lane
// instead of stalling every later pass behind a never-settling request.
export const VERIFY_REQUEST_TIMEOUT_MS = 10000;
