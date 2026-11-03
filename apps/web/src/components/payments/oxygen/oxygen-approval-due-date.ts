export function oxygenApprovalDueDate(
  due?: [number, number, number]
): string | undefined {
  return due
    ? new Intl.DateTimeFormat('en-NG', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(Date.UTC(due[0], due[1] - 1, due[2])))
    : undefined;
}
