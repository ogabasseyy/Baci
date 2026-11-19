/** The entries of the pending off-URL hand-off in sessionStorage, or undefined. */
export function readPendingHandoffEntries(): unknown {
  const raw = window.sessionStorage.getItem('baci:private-url-params-pending');
  if (raw === null) return undefined;
  // A parse error is left to throw: malformed writer output must fail the test.
  const parsed: unknown = JSON.parse(raw);
  return typeof parsed === 'object' && parsed !== null && 'entries' in parsed
    ? parsed.entries
    : undefined;
}
