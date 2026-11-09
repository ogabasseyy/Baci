/**
 * Validate email address format
 * Uses length limit and simpler pattern to prevent ReDoS
 */
export function isValidEmail(email: string): boolean {
  // Limit length to prevent ReDoS attacks
  if (!email || email.length > 254) return false;

  // Simple email validation - avoids complex patterns that can cause backtracking
  const atIndex = email.indexOf('@');
  if (atIndex < 1 || atIndex === email.length - 1) return false;

  const dotIndex = email.lastIndexOf('.');
  if (dotIndex < atIndex + 2 || dotIndex === email.length - 1) return false;

  // No whitespace allowed
  if (/\s/.test(email)) return false;

  return true;
}
