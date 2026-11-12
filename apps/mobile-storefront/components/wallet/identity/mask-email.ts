/** "ba***@gmail.com": enough to recognise, not enough to copy. */
export function maskEmail(email: string) {
  const [name = '', domain = ''] = email.split('@');
  return `${name.slice(0, 2)}***@${domain}`;
}
