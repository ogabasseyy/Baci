// A build verifier can dispatch two compilations, one prerender, and twelve
// captures sequentially. At 75 seconds per request, allow 75 seconds more
// for admission, database reads, and final evidence recording.
export const BUILD_VERIFIER_WORK_TIMEOUT_MS = 1_200_000;
export const BUILD_VERIFIER_CALL_TIMEOUT_MS = 1_250_000;
