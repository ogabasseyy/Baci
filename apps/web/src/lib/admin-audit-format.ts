/** Formats an audit timestamp for the operator-facing timeline. */
export function formatAdminAuditDate(value: string): string {
  return new Intl.DateTimeFormat('en-NG', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}
