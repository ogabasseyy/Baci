/**
 * "ba***@gmail.com": enough to recognise, not enough to copy. Short names
 * show at most half their letters, and anything that is not an address is
 * hidden entirely.
 */
export function maskEmail(email: string) {
  const at = email.lastIndexOf('@');
  if (at < 1 || at === email.length - 1) return '***';
  const name = email.slice(0, at);
  const shown = Math.min(2, Math.floor(name.length / 2));
  return `${name.slice(0, shown)}***@${email.slice(at + 1)}`;
}
