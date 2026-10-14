const boundedString = (value, length) =>
  typeof value === 'string' ? value.trim().slice(0, length) : '';

// Trailing window shared by list and detail queries: both must measure
// the same window for consistent occurrence semantics.
const OCCURRENCE_WINDOW = '-7d';

const MAX_RESPONSE_BYTES = 1_000_000;

const safeIssueId = (value) => {
  const issueId = boundedString(value, 120);
  return /^[A-Za-z0-9_-]+$/.test(issueId) ? issueId : '';
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
