const boundedString = (value, length) =>
  typeof value === 'string' ? value.trim().slice(0, length) : '';

// Trailing window shared by list and detail queries: both must measure
// the same window for consistent occurrence semantics.
const OCCURRENCE_WINDOW = '-7d';

const MAX_RESPONSE_BYTES = 1_000_000;

const safeIssueId = (value) => {
  const issueId = boundedString(value, 120);
  // PostHog serializes error-tracking issue IDs as UUIDs; anything else
  // is a malformed or compromised response and must not reach samples,
  // lifecycle state, or prompts.
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
    issueId
  )
    ? issueId
    : '';
};

// Single shared PostHog query contract behind one namespace export: list
// and detail requests stay coupled to the same window, bounds, and
// validators without duplicating them.
export const posthogQueryContract = {
  MAX_RESPONSE_BYTES,
  OCCURRENCE_WINDOW,
  boundedString,
  safeIssueId,
};
