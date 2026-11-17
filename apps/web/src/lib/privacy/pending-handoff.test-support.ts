/** The entries of the pending off-URL hand-off in sessionStorage, or undefined. */
export function readPendingHandoffEntries(): unknown {
  return JSON.parse(
    window.sessionStorage.getItem('baci:private-url-params-pending') ?? 'null'
  )?.entries;
}
